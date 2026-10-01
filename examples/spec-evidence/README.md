# 规格证据台

工程采购规格变更证据核验的本地工作台。导入旧、新规格和需求CSV，查看每项变化的原文位置，保存人工复核意见并生成可交接证据包。

在本目录安装 Node.js 22 或更新版本后运行（Windows、macOS、Linux 均可）：

```sh
npm start
```

打开 `http://127.0.0.1:8080`，先载入构造示例熟悉流程，再换成自己的资料。无需账户、付费或后端服务。页面使用模块脚本，请通过本地HTTP打开。

完整操作、输入格式、恢复与专业判断边界见 [DELIVERY.md](DELIVERY.md)。

开发检查：`npm ci`、`npx playwright install chromium`、`npm test`、`npm run test:browser`。浏览器测试会自动启动本机服务；也可用 `PRODUCT_URL` 指定已启动页面。
