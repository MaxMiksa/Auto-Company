# 浏览器检查说明

所有房间、日期、温湿度与费用均为构造数据。检查验证本地软件行为，不证明物理房间效果或真人采用。产品运行无需 Node 依赖；开发检查使用本目录声明的 Playwright Test 1.63.0。

在产品目录执行：

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

`playwright.config.js` 自动启动和停止只监听本机的测试服务器，Windows 使用 `python`，其他平台使用 `python3`。默认端口为 `41739`，可以通过 `REVERSIBLE_ROOM_TEST_PORT` 调整。不依赖原运行目录或外部临时安装。

失败追踪与截图保存在 `.auto-company/browser-results/`。测试包含方案选择、费用重算、风险限制、观察记录、搬迁再适配、真实备份下载恢复、打印、安全文本、键盘与手机操作。离线环境需预先具备相应 Chromium；Linux 还需浏览器系统库。
