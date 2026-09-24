"""Small bilingual catalog shared by the standalone maintenance executor."""

import ctypes
import locale
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess


def system_language():
    """OS UI language, without importing the installation being recovered."""
    def supported(value):
        return "zh-CN" if re.match(r"^zh(?:[-_.:@]|$)", value.strip(), re.I) else "en"

    def command(arguments):
        try:
            result = subprocess.run(arguments, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=4)
            return result.stdout.strip().lstrip("\ufeff") if result.returncode == 0 else ""
        except (OSError, subprocess.SubprocessError):
            return ""

    host = platform.system()
    if host == "Windows":
        try:
            return supported(locale.windows_locale.get(ctypes.windll.kernel32.GetUserDefaultUILanguage(), "en"))
        except (AttributeError, OSError):
            return "en"
    if host == "Darwin":
        match = re.search(r"[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*", command(["defaults", "read", "-g", "AppleLanguages"]))
        return supported(match[0]) if match else "en"
    if os.environ.get("WSL_INTEROP") or os.environ.get("WSL_DISTRO_NAME") or "microsoft" in platform.release().lower():
        executable = shutil.which("powershell.exe")
        if not executable:
            candidate = Path("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
            executable = str(candidate) if candidate.is_file() else None
        if executable:
            value = command([executable, "-NoProfile", "-NonInteractive", "-Command",
                             "Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern ushort GetUserDefaultUILanguage();' -Name Native -Namespace AutoCompany; [Globalization.CultureInfo]::GetCultureInfo([AutoCompany.Native]::GetUserDefaultUILanguage()).Name"])
            if value:
                return supported(value)
    for key in ("LC_ALL", "LANGUAGE", "LC_MESSAGES", "LANG"):
        if os.environ.get(key):
            return supported(os.environ[key].split(":", 1)[0])
    return "en"


MESSAGES = {
    "help": ("Commands: install --source PAYLOAD --target FOLDER --engine claude|codex; doctor --root FOLDER; update --root FOLDER --source PAYLOAD; rollback|uninstall|recover --root FOLDER. Add --yes to confirm changes, --language zh-CN|en to choose the installer language, and --json for diagnostics.", "命令：install --source 发行目录 --target 安装目录 --engine claude|codex；doctor --root 安装目录；update --root 安装目录 --source 发行目录；rollback|uninstall|recover --root 安装目录。添加 --yes 确认变更、--language zh-CN|en 选择安装器语言、--json 输出诊断。"),
    "installed": ("Installation is ready. The model loop is stopped.", "安装已就绪，模型循环保持停止。"),
    "updated": ("Update completed. Start the Dashboard when ready.", "更新完成。准备好后可打开看板。"),
    "rolled_back": ("The previous program version was restored; user data was preserved.", "已回退程序版本，用户数据保持不变。"),
    "recovered": ("The interrupted operation was recovered. User data was preserved.", "已恢复中断的操作，用户数据保持不变。"),
    "uninstalled": ("Program files were removed. Products, logs and configuration were preserved.", "已移除程序文件，产品、日志和配置已保留。"),
    "registered": ("The owned service or launcher was recorded.", "已记录属于本安装的服务或启动入口。"),
    "healthy": ("Managed files and local Git baseline are intact. No model request was sent.", "托管文件与本地 Git 基线完整；未发送模型请求。"),
    "confirmation": ("Review the operation and rerun with --yes to apply it.", "请核对操作内容，确认后添加 --yes 执行。"),
    "invalid_manifest": ("The release file manifest is invalid or incomplete.", "发行文件清单无效或不完整。"),
    "unsafe_path": ("An unsafe path, symbolic link, or conflicting file path was rejected.", "已拒绝不安全路径、符号链接或冲突文件路径。"),
    "integrity": ("Release content failed its byte or permission check.", "发行内容未通过字节或权限校验。"),
    "existing_target": ("The destination is not an unused verified payload or this manager's resumable installation. Choose a new folder.", "目标并非未使用的已验证发行目录，也不是本安装器可续装的目录。请选择新目录。"),
    "not_managed": ("This is not a valid managed installation. Keep using its original installation method.", "这不是有效的托管安装，请继续使用原安装方式。"),
    "posix_required": ("Run this command with Python in the saved WSL distribution on Windows, or native Python on macOS/Linux.", "Windows 请在已保存的 WSL 发行版中用 Python 执行；macOS/Linux 请用本机 Python。"),
    "git_changed": ("Git history, branch, index, or ownership changed. Resolve the changes manually before retrying.", "Git 历史、分支、索引或归属已改变，请手动处理后重试。"),
    "conflict": ("Locally changed program files or registry rows conflict with this operation. Preserve or merge them manually before retrying.", "本地修改的程序文件或注册表行与本操作冲突，请先保留或手动合并后重试。"),
    "busy": ("Stop this installation's loop and close its Dashboard, interactive sessions and configuration commands, then retry. Unknown processes are never terminated.", "请停止本安装的循环，关闭看板、交互会话和配置命令后重试；不会终止归属不明的进程。"),
    "maintenance": ("An unfinished maintenance transaction exists. Run the external recovery command shown in diagnostics first.", "存在未完成的维护事务，请先执行诊断中的外部恢复命令。"),
    "service_conflict": ("A service or launcher cannot be proven owned and stopped. Resolve its ownership or stop it before retrying.", "无法确认服务或启动入口属于本安装且已停止，请先解决归属或停止后重试。"),
    "space": ("There is not enough free space for verified staging and recovery backups.", "可用空间不足，无法保存已验证的暂存文件和恢复备份。"),
    "transaction_invalid": ("Recovery evidence is missing, changed or belongs to another installation. Files were not overwritten.", "恢复证据缺失、已改变或属于其他安装；未覆盖文件。"),
    "recovery_failed": ("Recovery did not finish. Keep the maintenance marker and external backups; rerun the external recovery command.", "恢复尚未完成，请保留维护标记与外部备份，并重新执行外部恢复命令。"),
    "operation_failed": ("The operation failed; any completed recovery is recorded in the transaction diagnostics.", "操作失败；已完成的恢复记录在事务诊断中。"),
    "rollback_unavailable": ("No verified previous release is available for rollback.", "没有可用于回退的已验证旧版本。"),
    "data_changed": ("Runtime state changed after the update. Data compatibility cannot be established automatically; review the saved transaction before rollback.", "更新后运行状态发生变化，无法自动确认数据兼容性；回退前请核对已保存的事务。"),
    "dependency": ("A required tool is unavailable. Prepare Python 3.10+ and Git in the runtime operating system.", "缺少必要工具，请在运行环境中准备 Python 3.10+ 与 Git。"),
    "invalid_arguments": ("The command arguments are invalid. See the command syntax below.", "命令参数无效，请查看下面的命令格式。"),
}


def message(code, language):
    pair = MESSAGES.get(code, MESSAGES["operation_failed"])
    return pair[1 if language == "zh-CN" else 0]
