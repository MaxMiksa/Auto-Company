# Project execution isolation

Every model cycle, interactive team, product check and screenshot worker must enter a Linux namespace boundary. A provider's `workspace-write` option does not restrict its own reads, configuration loading, MCP servers or descendants; it is an optional policy inside this boundary.

## Supported execution

Linux and Windows through WSL2 require bubblewrap 0.9 or newer, unprivileged user/mount/PID/IPC/network namespaces and libseccomp. Native Windows and macOS execution are refused. There is no unsafe fallback or disable-isolation option. Missing dependencies and unsupported CLI packaging fail before a model starts.

Install bubblewrap with your distribution package manager, or point `AUTO_COMPANY_BWRAP` at an operator-installed executable. Validate the actual kernel mechanism:

```bash
python3 scripts/core/project_isolation.py --check
ENGINE=codex MODEL=gpt-6.1-sol CODEX_REASONING_EFFORT=high make start
```

Ubuntu's AppArmor policy can prevent bubblewrap from configuring its isolated loopback (`RTM_NEWADDR: Operation not permitted`). An operator must enable the distribution's bubblewrap-specific user-namespace profile, checking existing profiles first to avoid conflicting attachments. Runtime startup leaves host policy unchanged and refuses execution until the preflight succeeds. The hosted CI setup loads Ubuntu's packaged profile on its disposable runner; it does not disable AppArmor or its system-wide restrictions. See [Ubuntu's user-namespace policy](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces).

Codex native binaries and the official Linux npm package are supported. The npm launcher is resolved as package data; only its native binary and code-mode helper enter the sandbox. Claude currently requires a native Linux binary and either its single credentials record or an explicit API-key environment variable. Cursor packaging/authentication has not been verified and is refused. OpenAI-compatible runs through the company adapter; its standalone script refuses host execution. Public endpoints are supported; host-local/private model servers need a separately designed broker and are currently unavailable.

Model and reasoning selections are preserved. The engine must actually support the requested model; isolation never substitutes a different model. Global provider configuration, plugins, MCP servers, session history and desktop browser connections are not imported. Codex receives only its authentication record and a fresh configuration/session directory; Claude receives only its authentication record. These scoped credentials remain readable by the model, so this is a host/project boundary, not a credential vault.

## What is visible

The engine sees `/workspace`: an explicit framework file manifest, the selected product, current scoped consensus, and that product's prior working documents. Exploration starts without old products or examples. Human governance sections remain exact. An unattributed or other-product legacy consensus contributes only its protected governance sections; unrelated product prose is not copied or preloaded in the prompt.

The framework scripts, role resources and human configuration are read-only. Product code, current documents, HOME, caches, session files and temporary files belong to this invocation. Nothing mounts the host root, home directory, Windows drives, shared temp directory, Docker socket, display socket or host process tree. Absolute links, escaping relative links, hard-linked files, device nodes, sockets and FIFOs in input/output trees are refused. Internal relative links such as package `.bin` links work.

Read-only runtime mounts are listed in `RUNTIME_PATHS` in `scripts/core/project_isolation.py`: Linux binaries/libraries, Node system modules, Git runtime data, TLS certificates and font resources. These are trusted operator-installed runtime files. Do not store project data or secrets in these system runtime locations. An optional framework-local Playwright dependency tree is also read-only. `AUTO_COMPANY_BROWSER_RUNTIME` names a reviewed Playwright browser directory; only the Chromium, headless Chromium and FFmpeg version directories are mounted, not cache metadata or profiles.

The operator's selected native Linux Node executable is mounted individually at `/opt/runtime/node`, including when installed by NVM or a CI tool cache. Its parent installation directory, global packages and caches are not exposed.

Chromium also needs its normal Linux shared libraries. Install them through the distribution, or set `AUTO_COMPANY_LIBRARY_RUNTIME` to a reviewed directory containing only the necessary `.so` files. That narrow directory is mounted read-only and replaces inherited library-search settings; an arbitrary host `LD_LIBRARY_PATH` is not imported.

The isolated network has its own loopback, so local application servers and browser tests work together. An invocation-specific HTTP proxy permits public HTTP/HTTPS destinations on ports 80/443. It resolves and validates all addresses, pins the destination IP, and rejects private, loopback, link-local and special-use addresses. Direct network access, host-local services, Unix host sockets, VSOCK and packet sockets are unavailable. Existing public HTTP upstream proxies may transport the pinned connection. Applications needing internet access must honor HTTP(S) proxy settings; raw outbound TCP/UDP is unavailable.

Product Git status and the clean-worktree check before an explicitly requested publication run in a disposable isolated copy. This includes product-local clean/process filters selected by `.gitattributes`; global Git configuration is absent and filter effects never return to the original. Filter diagnostics remain visible, and a nonzero Git exit refuses inspection. Product-local Git configuration belongs to that inspection's input. The ordinary model view continues to receive sanitized Git configuration.

Framework Python checks use the isolated `/usr/bin/python3`, including when the host launcher comes from a virtual environment or a CI tool cache. Other arbitrary host interpreter directories are not imported; install required project dependencies inside the project or provide reviewed runtime dependencies.

PID/user/network/mount/IPC namespaces, dropped capabilities, `no_new_privs` and seccomp apply to the complete engine, tools, native subagents, browsers and descendants. Namespace creation/entry, mounts, ptrace, process-memory access, kernel keyrings, VSOCK and unsafe terminal injection are blocked. This relies on the Linux kernel, bubblewrap, runtime binaries and trusted host orchestration. It does not protect against a compromised kernel, a malicious host operator or another process intentionally modifying inputs concurrently outside the ownership protocol.

## Collection and recovery

After the namespace exits, the host validates all output before replacing any product. Framework code and configuration never return. Identity changes are limited to one exploration-created product; old identities remain unchanged. Existing operator Git hooks/remotes are preserved on the host, while model-created Git configuration is sanitized. Only the current cycle's event stream and owned new artifact records are collected; old logs and host-authored context records cannot be overwritten. Running preview records become stopped when their namespace ends, with original records retained privately; the host never follows their loopback URLs for health checks or cleanup. Final screenshots use a separate isolated media worker.

Collection uses a persistent rename journal and retains previous versions. A pending journal blocks the next execution. Stop all writers and recover with:

```bash
python3 scripts/core/isolation_workspace.py --root /path/to/runtime --recover
```

Recovery restores original files and keeps rejected candidates for inspection; it does not claim to reverse network activity or other external business effects. Per-product working documents, scoped session records, last-run metadata and collection backups live under `.auto-company/isolation/`. An execution whose output fails validation retains its private temporary view and reports the location. Additional files created at the framework root also retain that view, with their names recorded in `last-run.json`; they are never silently discarded or copied over host control files.

## Verification

```bash
python3 -m unittest discover -s tests -p 'test_project_isolation.py' -v
```

Kernel tests require real Linux namespaces and bubblewrap; other platforms are explicitly skipped and are not claimed as verified. The suite exercises real child processes, read denial, normal writes, link rejection, backend failure, foreign-output refusal and interrupted collection recovery. Provider contract fixtures are separate from proof of OS isolation.
