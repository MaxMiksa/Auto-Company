# 量源复核

在本机浏览器中导入两个 IFC 版本，核对体积数量来源、单位与材料，定位缺失和冲突并导出复核底稿。

在本目录运行，Windows PowerShell：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe server.py --port 8765
```

打开 `http://127.0.0.1:8765`。macOS/Linux 使用 `python3` 创建环境，再使用 `.venv/bin/python` 安装和启动。保持终端运行，按 `Ctrl+C` 停止。

完整操作说明见 [DELIVERY.md](DELIVERY.md)。本工具使用模型已有数量，不重算几何、不推导采购量。合成示例用于演示，不代表真实客户模型。
