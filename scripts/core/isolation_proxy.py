"""A per-invocation public-network proxy; never an arbitrary host socket bridge."""
from __future__ import annotations

import ipaddress
import os
import select
import socket
import socketserver
from urllib.parse import urlsplit


def public_address(host, port):
    if not host or port not in (80, 443):
        raise ValueError("Only public HTTP(S) destinations are available")
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError("Local, private and special-use destinations are blocked")
    # Resolve once, validate every answer, then connect to the pinned IP.
    return addresses[0][4][0]


def relay(left, right):
    while True:
        ready, _, _ = select.select([left, right], [], [], 120)
        if not ready:
            return
        for source in ready:
            data = source.recv(65536)
            if not data:
                return
            (right if source is left else left).sendall(data)


def header(sock):
    value = bytearray()
    while not value.endswith(b"\r\n\r\n"):
        item = sock.recv(1)
        if not item or len(value) >= 65536:
            raise ValueError("Invalid proxy request")
        value.extend(item)
    return bytes(value)


def connect_public(host, port, upstream=None):
    address = public_address(host, port)
    if not upstream:
        return socket.create_connection((address, port), timeout=30)
    parsed = urlsplit(upstream)
    if parsed.scheme != "http" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Upstream proxy must be an unauthenticated HTTP proxy")
    connection = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=30)
    authority = f"[{address}]:{port}" if ":" in address else f"{address}:{port}"
    connection.sendall(f"CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n".encode())
    response = header(connection)
    if response.split(b" ", 2)[1] != b"200":
        connection.close()
        raise ValueError("Upstream proxy refused public destination")
    return connection


class PublicProxy(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, path):
        self.upstream = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        super().__init__(str(path), ProxyRequest)


class ProxyRequest(socketserver.BaseRequestHandler):
    def handle(self):
        remote = None
        try:
            self.request.settimeout(30)
            raw = header(self.request)
            method, target, version = raw.split(b"\r\n", 1)[0].decode("ascii").split(" ")
            if method == "CONNECT":
                parsed = urlsplit("//" + target)
                host, port = parsed.hostname, parsed.port or 443
                if parsed.path or parsed.username or parsed.password or port != 443:
                    raise ValueError("Invalid CONNECT destination")
            else:
                parsed = urlsplit(target)
                if parsed.scheme != "http" or parsed.username or parsed.password:
                    raise ValueError("Invalid HTTP destination")
                host, port = parsed.hostname, parsed.port or 80
                if port != 80:
                    raise ValueError("Invalid HTTP port")
            remote = connect_public(host, port, self.server.upstream)
            if method == "CONNECT":
                self.request.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            else:
                path = parsed.path or "/"
                if parsed.query:
                    path += "?" + parsed.query
                lines = raw.split(b"\r\n")[1:-2]
                lines = [line for line in lines if line.split(b":", 1)[0].lower() not in
                         (b"proxy-authorization", b"proxy-connection", b"connection", b"host")]
                lines += [f"Host: {host}".encode(), b"Connection: close"]
                remote.sendall(f"{method} {path} {version}\r\n".encode() + b"\r\n".join(lines) + b"\r\n\r\n")
            relay(self.request, remote)
        except (OSError, ValueError, UnicodeError):
            try:
                self.request.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
        finally:
            if remote:
                remote.close()


class LocalBridge(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


class BridgeRequest(socketserver.BaseRequestHandler):
    def handle(self):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as remote:
            remote.connect("/run/auto-company/egress.sock")
            relay(self.request, remote)


if __name__ == "__main__":
    LocalBridge(("127.0.0.1", 18080), BridgeRequest).serve_forever()
