"""Mandatory Linux namespace boundary shared by models and product renderers.

The caller is trusted orchestration. The command and all its descendants are
untrusted. No caller-provided environment flag disables this boundary.
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import json
import os
import platform
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading

from isolation_proxy import PublicProxy

HERE = Path(__file__).resolve().parent
# Public, operator-installed runtime files only. Never mount /, /home, /mnt,
# /run, /tmp, /etc as a whole, desktop sockets or an inherited working directory.
RUNTIME_PATHS = ("/usr/bin", "/usr/lib", "/usr/lib64", "/usr/share/nodejs",
                 "/usr/share/node_modules", "/usr/share/git-core", "/usr/share/fonts",
                 "/usr/share/fontconfig", "/etc/fonts", "/etc/ssl/certs",
                 "/etc/ld.so.cache", "/etc/mime.types", "/etc/alternatives/awk", "/etc/alternatives/nawk")


class IsolationError(ValueError):
    pass


def runtime_binary():
    if sys.platform != "linux":
        raise IsolationError("Project isolation requires Linux/WSL2; native Windows and macOS execution is unavailable")
    candidate = os.environ.get("AUTO_COMPANY_BWRAP") or shutil.which("bwrap")
    if not candidate or not Path(candidate).is_file():
        raise IsolationError("bubblewrap >= 0.9 is required (install it or set AUTO_COMPANY_BWRAP); unisolated execution is forbidden")
    path = Path(candidate).resolve()
    result = subprocess.run([str(path), "--help"], capture_output=True, text=True)
    if result.returncode or "--disable-userns" not in result.stdout or "--assert-userns-disabled" not in result.stdout:
        raise IsolationError("bubblewrap lacks required user-namespace enforcement")
    return str(path)


def inside_boundary():
    """Recognize our read-only kernel-mounted entry manifest, never an env flag."""
    marker = Path("/run/auto-company/command.json")
    try:
        if not os.statvfs(marker).f_flag & os.ST_RDONLY:
            return False
        manifest = json.loads(marker.read_text())
        status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
        return (os.readlink("/proc/self/ns/net") != manifest["hostNetworkNamespace"]
                and status["NoNewPrivs"].strip() == "1" and status["Seccomp"].strip() == "2"
                and int(status["CapEff"].strip(), 16) == 0)
    except (OSError, ValueError, KeyError):
        return False


def native_engine(binary):
    source = Path(binary).resolve()
    with source.open("rb") as stream:
        if stream.read(4) == b"\x7fELF":
            return source
    # Resolve the official npm launcher as data. Never execute a wrapper on
    # the host to discover another executable, and never mount node_modules.
    package = source.parent.parent
    metadata = package / "package.json"
    if source.name == "codex.js" and metadata.is_file() and json.loads(metadata.read_text()).get("name") == "@openai/codex":
        architecture = {"x86_64": ("x64", "x86_64"), "aarch64": ("arm64", "aarch64")}.get(platform.machine())
        if architecture:
            npm_arch, rust_arch = architecture
            for vendor in (package.parent / ("codex-linux-" + npm_arch) / "vendor", package / "vendor"):
                candidate = vendor / (rust_arch + "-unknown-linux-musl") / "bin/codex"
                if candidate.is_file():
                    with candidate.open("rb") as stream:
                        if stream.read(4) == b"\x7fELF":
                            return candidate.resolve()
    raise IsolationError("Selected CLI has no supported native Linux package; unisolated wrappers are forbidden")


def checked_tree(root):
    """Check a stopped source tree before mounting/copying. Never follow links."""
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise IsolationError("Isolation input must be a real directory")
    for folder, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(folder) / name
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                target = Path(os.readlink(path))
                if target.is_absolute():
                    raise IsolationError("Absolute input/output links are forbidden")
                try:
                    path.resolve().relative_to(root.resolve())
                except (ValueError, RuntimeError):
                    raise IsolationError("Input/output link leaves its project") from None
            elif stat.S_ISREG(info.st_mode):
                if info.st_nlink != 1:
                    raise IsolationError("Hard-linked input/output files are forbidden")
            elif not stat.S_ISDIR(info.st_mode):
                raise IsolationError("Sockets, devices and FIFOs are forbidden in project inputs/outputs")


def seccomp_file(folder):
    # libseccomp emits the native architecture filter and rejects foreign ABIs.
    lib = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_export_bpf.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    ctx = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not ctx:
        raise IsolationError("Cannot create seccomp policy")
    class Compare(ctypes.Structure):
        _fields_ = [("arg", ctypes.c_uint), ("op", ctypes.c_int), ("a", ctypes.c_uint64), ("b", ctypes.c_uint64)]
    denied = ("mount", "umount2", "pivot_root", "chroot", "setns", "unshare", "ptrace",
              "process_vm_readv", "process_vm_writev", "open_by_handle_at", "name_to_handle_at",
              "bpf", "keyctl", "add_key", "request_key", "perf_event_open", "io_uring_setup",
              "kexec_load", "reboot")
    try:
        for name in denied:
            number = lib.seccomp_syscall_resolve_name(name.encode())
            if number >= 0 and lib.seccomp_rule_add(ctx, 0x50000 | errno.EPERM, number, 0):
                raise IsolationError("Cannot install syscall restriction")
        number = lib.seccomp_syscall_resolve_name(b"socket")
        # VSOCK, packet sockets and other non-IP families are not namespaced
        # consistently across Linux/WSL; permit only UNIX, IPv4 and IPv6.
        for family in range(0, 46):
            if family not in (1, 2, 10) and lib.seccomp_rule_add(ctx, 0x50000 | errno.EPERM, number, 1, Compare(0, 4, family, 0)):
                raise IsolationError("Cannot restrict socket families")
        clone3 = lib.seccomp_syscall_resolve_name(b"clone3")
        if clone3 >= 0:
            lib.seccomp_rule_add(ctx, 0x50000 | errno.ENOSYS, clone3, 0)
        for request in (0x5412, 0x541C):
            number = lib.seccomp_syscall_resolve_name(b"ioctl")
            if lib.seccomp_rule_add(ctx, 0x50000 | errno.EPERM, number, 1, Compare(1, 4, request, 0)):
                raise IsolationError("Cannot restrict terminal injection")
        path = Path(folder) / "seccomp.bpf"
        with path.open("wb") as target:
            if lib.seccomp_export_bpf(ctx, target.fileno()):
                raise IsolationError("Cannot export seccomp policy")
        return path
    finally:
        lib.seccomp_release(ctx)


def base_environment():
    return {"PATH": "/opt/engine:/usr/bin:/bin", "HOME": "/home/agent", "USER": "agent",
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TMPDIR": "/tmp",
            "XDG_CACHE_HOME": "/home/agent/.cache", "XDG_CONFIG_HOME": "/home/agent/.config",
            "CODEX_HOME": "/home/agent/.codex", "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null", "PYTHONNOUSERSITE": "1",
            "HTTP_PROXY": "http://127.0.0.1:18080", "HTTPS_PROXY": "http://127.0.0.1:18080",
            "http_proxy": "http://127.0.0.1:18080", "https_proxy": "http://127.0.0.1:18080",
            "NO_PROXY": "localhost,127.0.0.1,::1", "no_proxy": "localhost,127.0.0.1,::1"}


def run_isolated(command, workspace, *, cwd="/workspace", home=None, readonly=(), environment=None,
                 output=None, engine=None, interactive=False, launch_status=None):
    bwrap = runtime_binary()
    workspace = Path(workspace).absolute()
    if any(part.is_symlink() for part in (workspace, *workspace.parents)):
        raise IsolationError("Workspace and its ancestors must not be symlinks")
    workspace = workspace.resolve()
    checked_tree(workspace)
    with tempfile.TemporaryDirectory(prefix="auto-company-isolation-") as temporary:
        temporary = Path(temporary)
        local_home = Path(home) if home else temporary / "home"
        local_home.mkdir(parents=True, exist_ok=True)
        checked_tree(local_home)
        policy = seccomp_file(temporary)
        env = base_environment()
        env.update(environment or {})
        if interactive:
            env["TERM"] = os.environ.get("TERM", "xterm-256color")
        libraries = os.environ.get("AUTO_COMPANY_LIBRARY_RUNTIME")
        if libraries:
            library_root = Path(libraries).resolve()
            checked_tree(library_root)
            if any(child.is_dir() or ".so" not in child.name for child in library_root.iterdir()):
                raise IsolationError("Additional library runtime must contain only reviewed shared libraries")
            env["LD_LIBRARY_PATH"] = "/opt/runtime-libs"
        settings = temporary / "command.json"
        launch = temporary / "launch.json"
        launch.write_text('{"started": false}')
        settings.write_text(json.dumps({"command": command, "cwd": cwd, "env": env,
                            "hostNetworkNamespace": os.readlink("/proc/self/ns/net")}), encoding="utf-8")
        socket_path = temporary / "egress.sock"
        args = [bwrap, "--unshare-all", "--unshare-user", "--disable-userns", "--assert-userns-disabled", "--die-with-parent",
                "--new-session", "--cap-drop", "ALL", "--clearenv", "--setenv", "PATH", "/usr/bin:/bin",
                "--setenv", "LANG", "C.UTF-8", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
                "--tmpfs", "/run", "--dir", "/home", "--dir", "/etc", "--hostname", "auto-company"]
        for source in RUNTIME_PATHS:
            if Path(source).exists():
                args += ["--ro-bind", str(Path(source).resolve()), source]
        if libraries:
            args += ["--ro-bind", str(library_root), "/opt/runtime-libs"]
        for name, target in (("/bin", "usr/bin"), ("/sbin", "usr/bin"), ("/lib", "usr/lib"), ("/lib64", "usr/lib64")):
            if Path(name).exists():
                args += ["--symlink", target, name]
        args += ["--bind", str(workspace), "/workspace", "--bind", str(local_home), "/home/agent",
                 "--dir", "/run/auto-company", "--ro-bind", str(socket_path), "/run/auto-company/egress.sock",
                 "--bind", str(launch), "/run/auto-company/launch.json",
                 "--ro-bind", str(settings), "/run/auto-company/command.json"]
        for name in ("isolation_entry.py", "isolation_proxy.py"):
            args += ["--ro-bind", str(HERE / name), "/run/auto-company/" + name]
        if engine:
            source = native_engine(engine)
            args += ["--dir", "/opt/engine", "--ro-bind", str(source), "/opt/engine/agent"]
            helper = source.with_name("codex-code-mode-host")
            if helper.is_file():
                args += ["--ro-bind", str(helper), "/opt/engine/codex-code-mode-host"]
        for source, target in readonly:
            source = Path(source).resolve()
            if source.is_dir():
                checked_tree(source)
            args += ["--ro-bind", str(source), target]
        args += ["--chdir", cwd]
        proxy = PublicProxy(socket_path)
        worker = threading.Thread(target=proxy.serve_forever, daemon=True)
        worker.start()
        process = None
        previous = {}
        try:
            with policy.open("rb") as descriptor:
                args += ["--seccomp", str(descriptor.fileno()), "--", "/usr/bin/python3", "/run/auto-company/isolation_entry.py"]
                process = subprocess.Popen(args, pass_fds=(descriptor.fileno(),), stdout=output, stderr=output,
                                           stdin=None if interactive else subprocess.DEVNULL, env={"PATH": "/usr/bin:/bin"})
                if threading.current_thread() is threading.main_thread():
                    def stop(signum, _frame):
                        if process.poll() is None:
                            process.terminate()
                    for signum in (signal.SIGTERM, signal.SIGINT):
                        previous[signum] = signal.signal(signum, stop)
                return process.wait()
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)
            if process and process.poll() is None:
                process.kill()
                process.wait()
            proxy.shutdown()
            proxy.server_close()
            if launch_status:
                try:
                    started = json.loads(launch.read_text()).get("started") is True
                except (OSError, ValueError, AttributeError):
                    started = False
                Path(launch_status).write_text(json.dumps({"started": started}))


def git_status(project, output=None):
    command = ["/usr/bin/git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
               "-c", "core.untrackedCache=false", "status", "--porcelain"]
    if inside_boundary():
        return subprocess.run(command, cwd=project, stdout=output, stderr=output).returncode
    runtime_binary()
    # Git status can run clean/process filters selected by product attributes.
    # Keep product-local filter behavior, but execute it only in a disposable
    # copy under the same kernel boundary. Never collect inspection side effects.
    from isolation_workspace import copy_tree
    with tempfile.TemporaryDirectory(prefix="auto-company-git-status-") as temporary:
        snapshot = Path(temporary) / "project"
        copy_tree(project, snapshot)
        return run_isolated(command, snapshot, output=output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--engine-version")
    parser.add_argument("--git-status", type=Path)
    parser.add_argument("--launch-status")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.git_status:
        return git_status(args.git_status)
    if args.engine_version:
        with tempfile.TemporaryDirectory() as workspace:
            return run_isolated(["/opt/engine/agent", "--version"], workspace, engine=args.engine_version)
    if args.check:
        with tempfile.TemporaryDirectory() as workspace:
            return run_isolated(["/usr/bin/true"], workspace)
    if not args.workspace or not args.command:
        parser.error("--workspace and a command are required")
    command = args.command[1:] if args.command[0] == "--" else args.command
    if command and command[0] == sys.executable:
        # A framework check may be launched by a host venv/tool-cache Python.
        # Use the explicit isolated runtime, never import that entire host tree.
        command[0] = "/usr/bin/python3"
    readonly = []
    helper = str(HERE / "check_adapters.py")
    if helper in command:
        command = ["/run/auto-company/check_adapters.py" if part == helper else part for part in command]
        readonly.append((helper, "/run/auto-company/check_adapters.py"))
    environment = {}
    report = os.environ.get("PLAYWRIGHT_JSON_OUTPUT_FILE")
    if report:
        relative = Path(report).resolve().relative_to(args.workspace.resolve())
        environment["PLAYWRIGHT_JSON_OUTPUT_FILE"] = "/workspace/" + relative.as_posix()
    return run_isolated(command, args.workspace, readonly=readonly, environment=environment, launch_status=args.launch_status)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (IsolationError, OSError) as error:
        print(f"Project isolation refused startup: {error}", file=sys.stderr)
        sys.exit(78)
