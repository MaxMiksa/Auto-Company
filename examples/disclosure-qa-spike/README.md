# 披露双检

本机 PDF 批次审校工作台。登记批准规则，检查必须删除与必须保留的文字，逐件记录人工复核，并导出与文件指纹绑定的交接记录。产品不修改 PDF，不认证安全或法律合规；扫描件、视觉遮盖和上下文需要人工核对。

## 安装与打开

需要 Ubuntu / WSL2、Python 3.12 或更新版本。文件检查使用 Linux 进程资源限制；Windows 浏览器可访问 WSL 的本机地址。进入本目录运行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py --port 8765
```

打开 [本机工作台](http://127.0.0.1:8765)，先用四份合成文件体验漏删、过删和扫描件复核。首次安装需要网络；文件仅发给本机服务，不上传外部服务。PDF 字节不会留存，规则和报告可按界面选项暂存于当前标签页。

完整流程、恢复、大小限制和许可边界见 [DELIVERY.md](DELIVERY.md)。运行依赖 PyMuPDF，其 AGPL / 商业许可义务须按实际分发方式确认。

## 开发检查

在同一 Ubuntu / WSL 环境安装浏览器测试依赖，再运行全部核心、错误恢复、HTTP 与真实浏览器流程：

```sh
.venv/bin/python -m pip install playwright
.venv/bin/python -m playwright install chromium
.venv/bin/python -m unittest tests.test_workflow -v
```

缺少浏览器或文件解析依赖会使检查失败，不算通过。可通过 `BROWSER_EVIDENCE_DIR` 指定截图与合成下载证据的位置。

## 来源与边界

本目录来自 Auto Company 的真实模型运行交付，本次展示进行了人工界面精修与独立启动整理。示例不是真人文件或准确率测量，没有证明相对人工工作流更省工、用户采用、交易或盈利。

`experiment.py`、`retention_experiment.py` 与 `audit.py` 保留早期机会实验代码；它们依赖原研究环境和外部基线工具，不是工作台启动入口。原始运行和历史证据保持原位，未随此展示副本公开。当前产品实现说明见 [engine](docs/delivery/engine.md)、[interface](docs/delivery/interface.md) 与 [qa](docs/delivery/qa.md)。
