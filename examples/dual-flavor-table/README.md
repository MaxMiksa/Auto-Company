# 一桌双味

无需自行录入菜谱的双口味整餐手册。六套完整晚餐，按两组人数和口味生成共享采购、备料与分盘操作；支持素食、食材排除、保存进度、文字下载、打印与备份恢复。

在本目录运行：

```sh
python -m http.server 8080 --bind 127.0.0.1
```

打开 http://127.0.0.1:8080 。无需构建、账号或联网服务；不要双击 HTML，浏览器对本地 ES 模块有访问限制。

完整使用、开发检查、数据恢复与内容边界见 [DELIVERY.md](DELIVERY.md)。

本目录为 Auto Company 登记管理的独立本地产品仓库。

Windows 使用 `python`；macOS / Linux 使用 `python3`。也可在产品目录执行 `npm start`。
