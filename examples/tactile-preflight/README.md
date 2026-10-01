# 触图审查台

在本机浏览器导入触觉SVG，确认打印尺寸，阅读对象间关系，记录审查判断，调整标签并导出可恢复的工作。

在本目录运行：

```sh
python serve.py
```

打开终端显示的 `http://127.0.0.1:8765/`，保持终端运行，按 Ctrl+C 停止。端口占用时使用 `python serve.py --port 0`。macOS/Linux 可将 `python` 换成 `python3`。产品运行只需要Python 3与现代浏览器，无账户、安装包或外部API。请通过本机HTTP入口使用，双击HTML的file协议可能无法加载模块与样本。

先选择“标签修改示例”练习，再上传自己的SVG；像素尺寸图必须填写实际打印宽高毫米。所有图形内容在浏览器本地处理，不上传。退出前下载审查JSON，重新打开后导入JSON恢复。

完整操作、输入边界、验证方式与剩余限制见 [DELIVERY.md](DELIVERY.md)。样本来源及历史证据见 [samples/README.md](samples/README.md)。
