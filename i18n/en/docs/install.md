# Download and guided installation

Official distribution archives let you install Auto Company from a GitHub Release without cloning the repository first. The Windows package continues to run models and product code inside WSL2; macOS and Linux use the host runtime. The installer does not bundle model CLIs, Python, or Git, and it cannot sign in to a model account for you.

If the current release does not contain the assets listed below, continue using the Git clone instructions in the README. This guide applies only to a Release that explicitly includes the platform assets, `release-manifest.json`, and `SHA256SUMS.txt`.

| Order | Action | Completion signal |
| --- | --- | --- |
| 1 | Download the platform asset and checksum file from one official Release | The versions in both filenames match |
| 2 | Verify SHA-256 before extraction | The local digest matches the published value |
| 3 | Review the plan, then confirm guided setup | Core, media, and login status are reported separately |
| 4 | Start from the Dashboard explicitly | Only this action can enter the model loop |

## 1. Download and verify before first execution

Open one version on the project's [Releases page](https://github.com/MaxMiksa/Auto-Company/releases), then download the asset for your platform and `SHA256SUMS.txt`:

| Platform | Asset |
| --- | --- |
| Windows 11 + WSL2 | `Auto-Company-vX.Y.Z-windows.zip` |
| macOS | `Auto-Company-vX.Y.Z-macos.tar.gz` |
| Ubuntu Linux | `Auto-Company-vX.Y.Z-linux.tar.gz` |

Verify SHA-256 before extracting the archive or running anything from it. In Windows PowerShell:

```powershell
$Asset = '.\Auto-Company-vX.Y.Z-windows.zip'
$Actual = (Get-FileHash -LiteralPath $Asset -Algorithm SHA256).Hash.ToLowerInvariant()
$Expected = ((Select-String -LiteralPath '.\SHA256SUMS.txt' -Pattern '  Auto-Company-vX.Y.Z-windows\.zip$').Line -split '\s+')[0].ToLowerInvariant()
if (-not $Expected -or $Actual -ne $Expected) { throw 'SHA-256 verification failed. Do not extract or run this asset.' }
```

On Linux:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
```

On macOS:

```bash
expected="$(awk '$2 == "Auto-Company-vX.Y.Z-macos.tar.gz" { print $1 }' SHA256SUMS.txt)"
actual="$(shasum -a 256 Auto-Company-vX.Y.Z-macos.tar.gz | awk '{ print $1 }')"
test -n "$expected" && test "$actual" = "$expected"
```

The checksum confirms that the downloaded bytes match the published asset. It is not an operating-system code signature. The official GitHub Release page remains the trust source for the first execution.

## 2. Run the guide

On Windows, extract the verified ZIP, open PowerShell in the extracted directory, and run:

```powershell
.\setup.ps1 -Plan       # show the plan only
.\setup.ps1             # show the plan and ask for confirmation
```

On macOS or Linux, extract the verified archive and run:

```bash
tar -xzf Auto-Company-vX.Y.Z-macos.tar.gz   # use linux.tar.gz on Linux
cd Auto-Company-vX.Y.Z
bash setup.sh --plan
bash setup.sh
```

The guide first shows the platform, target directory, missing dependencies, and proposed changes, then asks for confirmation. Cancelling does not apply unapproved changes for the current stage; on a resumed setup it does not roll back stages already completed. The first interactive run asks you to choose Codex or Claude. You can choose explicitly with `-Engine codex` / `--engine codex`. On Windows, `-Distro NAME` pins the WSL distribution, and later start, stop, and status commands reuse it.

The initial language follows the operating-system UI: Chinese selects `zh-CN`, and other languages select `en`. To override detection, use `-Language zh-CN` or `-Language en` on Windows, and `--language zh-CN` or `--language en` on macOS/Linux. The same choice applies to the Dashboard and new products. Existing products and history are not translated retroactively.

The product screenshot environment is skipped by default. Add Windows `-Media` or macOS/Linux `--media` to install it; it can also be added later. On a resumed setup, `-SkipMedia` / `--skip-media` overrides a previously saved media choice. Skipping it does not affect the Dashboard or core loop. The guide uses a tested Node version and locked browser dependencies instead of downloading a browser during model work.

Installation does not invoke a model and does not treat a CLI file or `--version` response as proof that an account is authenticated. Authentication remains pending by default. Only explicit `-Login` / `--login` enters the selected engine's official interactive login. `-Yes` / `--yes` approves the already displayed installation plan; it does not sign in or send a model request. After preparation, the background service remains stopped with autostart disabled. The Dashboard opens by default, and you choose when to start the model loop. Use `-NoDashboard` / `--no-dashboard` to install without opening it.

If Windows must enable WSL or create a normal Linux user, the guide saves the choices needed to continue and clearly requests a restart or user setup. It does not report installation success. Only the Windows preparation stage can be approved at that point. After restart and Linux user creation, the guide can inspect the actual WSL dependencies; it displays and separately confirms those newly known changes instead of treating them as part of an earlier approval. On macOS without Homebrew, it shows the official manual preparation path and does not execute remote `curl | sh` commands.

If an enterprise PowerShell policy or macOS download-security policy blocks the script, follow the official operating-system or organization guidance for that file. Do not permanently loosen the global PowerShell execution policy or recursively remove security metadata from unrelated files.

## 3. Installation and upgrade data boundaries

A managed installation records release hashes and a local Git baseline. It does not configure a remote, alter your global Git identity, or upload content. Existing clones, worktrees, and customized directories are not taken over automatically. Keep using the existing workflow or install into a new stable directory.

The updater does not check for or download versions from the network. First download, verify, and extract a new package from an official Release. Then close this installation's model loop, Dashboard, `make team` sessions, and configuration writers. A maintenance command refuses to continue while a writer remains; it does not force-kill processes. After they are stopped, it checks the new package and local files for conflicts. It preserves:

- local preferences and state in `.auto-company.local`, `.auto-loop.env`, and `.auto-company/`;
- `memories/`, logs, user products, generated documents, and screenshots;
- model authentication, CLI configuration, system proxy settings, and existing global tools;
- user-owned rows in the project registry.

If program files, prompts, skills, or bundled examples were modified, the upgrade lists the conflict and stops. It does not silently overwrite the change or guess a merge. Registry changes use the old release baseline, local content, and new release baseline; same-name conflicts require a decision. Upgrades are never silent background operations, and recovery material remains available until the transaction succeeds.

Every maintenance command that changes an installation requires explicit `--yes`, including recovery. If the program directory is damaged, run the recovery copy from the transaction outside the installation, for example `python3 <transaction>/executor/manager.py recover --root <install-root> --transaction <transaction> --yes`. Do not depend on the copy being repaired. `doctor` checks integrity, the Git baseline, and local state without invoking a model; it reports authentication as unverified.

A rollback refuses to overwrite configuration or `.auto-company/` state that changed after the update. User product repositories and user-owned registry rows are not treated as release data to roll back. Before uninstalling, stop this installation's background service and disable autostart. After checking ownership, uninstall removes the registration, archives the managed Git baseline in the external transaction directory, and preserves user data.

Uninstall removes only program files, service registration, and launch entries owned by this installation by default. Products, logs, and configuration remain. Deleting user data requires a separate explicit choice. The installer does not remove an existing Python, Git, Node, model CLI, Homebrew, WSL installation, or Linux distribution.

## 4. Support boundaries

The first automated preparation and acceptance targets are Windows 11 x64 with WSL2 Ubuntu 24.04, macOS, and Ubuntu 24.04 with a systemd user session. Other Windows versions, macOS architectures, and Linux distributions are supported only when the relevant Release notes explicitly list them. Network, proxy, restart, operating-system permission, and model sign-in steps can still require user action.

Installation success means that the program and selected dependencies are prepared. It does not prove model authentication, available quota, or a successful paid request. When the screenshot component is absent, the Dashboard and core loop still work, while automatic product screenshots report that the optional component is not ready.
