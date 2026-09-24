# 下载与引导安装

正式分发包让你从 GitHub Release 安装 Auto Company，无需先克隆仓库。Windows 包继续在 WSL2 中运行模型和产品代码；macOS 与 Linux 使用本机运行时。安装器不会捆绑模型 CLI、Python 或 Git，也不能替你完成模型账号登录。

当前已发布的版本若没有下列附件，请继续使用 README 中的 Git clone 方式。只有明确包含平台附件、`release-manifest.json` 和 `SHA256SUMS.txt` 的 Release 才支持本页流程。

| 顺序 | 操作 | 完成标志 |
| --- | --- | --- |
| 1 | 从同一个正式 Release 下载平台附件与校验文件 | 文件名版本一致 |
| 2 | 在解压前核对 SHA-256 | 本机计算值与发布值相同 |
| 3 | 先查看计划，再确认引导安装 | 核心就绪；媒体与登录分别显示状态 |
| 4 | 在 Dashboard 中主动开始 | 只有此时才允许进入模型循环 |

## 1. 下载并在首次执行前校验

从项目的 [Releases 页面](https://github.com/MaxMiksa/Auto-Company/releases)打开同一个正式版本，下载你的平台附件和 `SHA256SUMS.txt`：

| 平台 | 附件 |
| --- | --- |
| Windows 11 + WSL2 | `Auto-Company-vX.Y.Z-windows.zip` |
| macOS | `Auto-Company-vX.Y.Z-macos.tar.gz` |
| Ubuntu Linux | `Auto-Company-vX.Y.Z-linux.tar.gz` |

在解压和运行任何包内脚本之前核对 SHA-256。Windows PowerShell：

```powershell
$Asset = '.\Auto-Company-vX.Y.Z-windows.zip'
$Actual = (Get-FileHash -LiteralPath $Asset -Algorithm SHA256).Hash.ToLowerInvariant()
$Expected = ((Select-String -LiteralPath '.\SHA256SUMS.txt' -Pattern '  Auto-Company-vX.Y.Z-windows\.zip$').Line -split '\s+')[0].ToLowerInvariant()
if (-not $Expected -or $Actual -ne $Expected) { throw 'SHA-256 校验失败；不要解压或运行此附件。' }
```

Linux：

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
```

macOS：

```bash
expected="$(awk '$2 == "Auto-Company-vX.Y.Z-macos.tar.gz" { print $1 }' SHA256SUMS.txt)"
actual="$(shasum -a 256 Auto-Company-vX.Y.Z-macos.tar.gz | awk '{ print $1 }')"
test -n "$expected" && test "$actual" = "$expected"
```

校验值用于确认下载字节与发布附件一致，不等同于操作系统代码签名。首次执行的信任来源仍是项目的官方 GitHub Release 页面。

## 2. 运行引导

Windows 在校验后解压 ZIP，打开解压出的目录，在 PowerShell 运行：

```powershell
.\setup.ps1 -Plan       # 只显示计划
.\setup.ps1             # 显示计划并交互确认
```

macOS 或 Linux 在校验后解压并运行：

```bash
tar -xzf Auto-Company-vX.Y.Z-macos.tar.gz   # Linux 请改为 linux.tar.gz
cd Auto-Company-vX.Y.Z
bash setup.sh --plan
bash setup.sh
```

引导会先显示平台、目标目录、缺少的依赖和准备执行的更改，再要求确认。取消不会执行当前阶段尚未批准的更改；续跑时已经完成的阶段不会因此回滚。首次交互会提示选择 Codex 或 Claude。也可使用 `-Engine codex` / `--engine codex` 显式选择；Windows 的 `-Distro NAME` 可固定 WSL 发行版，后续启动、停止和状态命令会沿用它。

首次语言跟随操作系统界面：中文界面使用 `zh-CN`，其他语言使用 `en`。需要覆盖自动判断时，Windows 使用 `-Language zh-CN` 或 `-Language en`，macOS/Linux 使用 `--language zh-CN` 或 `--language en`。同一选择会用于 Dashboard 和新产品；已有产品和历史内容不会被追溯翻译。

产品截图环境默认跳过。需要它时使用 Windows `-Media` 或 macOS/Linux `--media`；以后也可以补装。续跑时要覆盖此前保存的媒体选择，可使用 `-SkipMedia` / `--skip-media`。跳过不会影响 Dashboard 和核心循环。引导固定使用经过验收的 Node 版本和浏览器依赖，不会在模型轮次中临时下载浏览器。

安装过程不会调用模型，也不会用 CLI 文件存在或 `--version` 冒充账号已登录。默认把登录标为待完成；只有显式使用 `-Login` / `--login` 才进入所选引擎的官方交互登录。`-Yes` / `--yes` 只批准已经展示的安装清单，不会暗中登录或发送模型请求。后台服务准备完成后保持停止且不启用开机运行；默认打开 Dashboard，由你决定何时开始模型循环。需要仅安装而不打开 Dashboard 时使用 `-NoDashboard` / `--no-dashboard`。

如果 Windows 需要启用 WSL 或创建普通 Linux 用户，引导会保存继续所需的选择并明确要求重启或完成用户创建，不会显示安装成功。此时只能确认 Windows 准备阶段；重启并创建用户后，WSL 内的实际依赖才可完整探测，引导会展示并单独确认这一阶段的新变更，不会把它们算进此前尚不可知的批准。macOS 没有 Homebrew 时会给出官方手工准备步骤，不会执行远程 `curl | sh`。

如果 PowerShell 企业策略或 macOS 下载安全策略阻止脚本，请按照操作系统或组织的官方指引处理该文件。不要永久放宽全局 PowerShell 执行策略，也不要递归移除其他文件的安全标记。

## 3. 安装与升级的数据边界

托管安装会记录发行文件的哈希和本地 Git 基线，但不会设置远程仓库、修改全局 Git 身份或上传内容。普通 clone、worktree 和现有自定义目录不会被自动接管；可以继续沿用原来的运行方式，或安装到一个新的稳定目录。

升级不会自己联网查找或下载版本。你需要先从正式 Release 下载、校验并解压新包，再关闭本安装的模型循环、Dashboard、`make team` 会话和配置写入命令。只要仍有写入者，维护命令就会拒绝继续，不会强行结束进程。确认停止后，它才会检查新包与本地冲突。以下内容保留：

- `.auto-company.local`、`.auto-loop.env` 与 `.auto-company/` 中的本地设置和状态；
- `memories/`、日志、用户产品、生成的文档和截图；
- 模型登录、CLI 配置、系统代理及用户已有的全局工具；
- 注册表中的用户项目行。

如果发行程序文件、提示词、技能或随包示例已被修改，升级会列出冲突并停止，不会静默覆盖或猜测合并结果。注册表按旧发行基线、本地内容和新发行基线三方处理；同名冲突需要人工决定。升级不会在后台静默执行，也不会在成功前删除恢复资料。

所有会修改安装的维护命令都要求明确的 `--yes`，包括恢复。程序目录损坏时，从安装目录外的事务备份执行恢复器，例如 `python3 <transaction>/executor/manager.py recover --root <安装目录> --transaction <事务目录> --yes`；不要依赖正在恢复的程序副本。`doctor` 只检查完整性、Git 基线和本地状态，不调用模型，登录状态会如实显示为未验证。

在 macOS/Linux 终端执行下面的命令。Windows 请先进入安装时选择的 WSL 发行版（例如 `wsl -d Ubuntu`），并使用 WSL 路径，例如 `/mnt/c/Users/你的用户名/Auto-Company`。把路径替换为实际安装目录与已校验的新包目录，保留引号：

```bash
install_root='/实际安装目录/Auto-Company'
new_package='/已解压的新包/Auto-Company-vX.Y.Z'
python3 "$install_root/scripts/install/manager.py" doctor --root "$install_root"
python3 "$new_package/scripts/install/manager.py" update --root "$install_root" --source "$new_package"
```

最后一条命令先检查并显示待确认操作，不会更新文件；确认后，在同一条命令末尾加 `--yes` 执行升级。需要回退或卸载时，分别执行：

```bash
python3 "$install_root/scripts/install/manager.py" rollback --root "$install_root" --yes
python3 "$install_root/scripts/install/manager.py" uninstall --root "$install_root" --yes
```

这两条是不同操作，请只执行需要的一条；卸载前必须先停止服务并关闭自启。

回退会拒绝覆盖更新后发生变化的配置和 `.auto-company/` 状态。用户产品仓库与注册表用户行不会被当作发行数据回退。需要卸载时，先把本安装的后台服务停用并关闭自启；卸载器验证归属后移除登记，把受管 Git 基线归档到外部事务目录，并保留用户数据。

卸载默认只移除本安装负责的程序、服务登记和启动入口，保留产品、日志与配置。删除用户数据必须单独明确选择；安装器不会卸载用户原有的 Python、Git、Node、模型 CLI、Homebrew、WSL 或整个 Linux 发行版。

## 4. 支持边界

首批自动准备与验收目标是 Windows 11 x64 + WSL2 Ubuntu 24.04、macOS 和带 systemd user 会话的 Ubuntu 24.04。其他 Windows、macOS 架构与 Linux 发行版只有在对应版本的 Release 说明明确列出时才算正式支持。网络、代理、重启、系统权限与模型网页登录仍可能需要用户处理。

安装完成只表示程序和已选择的依赖准备完成，不表示模型账号、额度或实际请求可用。截图组件未安装时，Dashboard 和核心循环仍可使用，但自动产品截图会显示未就绪。
