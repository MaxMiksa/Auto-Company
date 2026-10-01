# 参途

混合活动参与路径演练与变更恢复工作台。录入活动、服务和参加路径，记录最终端演练证据，处理资源变更和最新确认，导出中文交接及 JSON 备份。

```sh
npm start
```

需要 Node.js 20 以上；在浏览器打开 `http://127.0.0.1:4189/`。完整操作、失败恢复、证据边界和隐私说明见 [DELIVERY.md](DELIVERY.md)。

界面和业务逻辑使用原生 HTML/CSS/JavaScript，无日常运行依赖，无登录和上传。开发检查需要 Node 与测试依赖；历史机会评估与原失败证据保持原样，不能把本地检查当成现实活动成功。

## 开发检查

运行 `npm ci` 后，`npm test` 执行核心与恢复检查；`npm run test:browser` 执行真实 Chromium 流程。首次测试请运行 `npx playwright install chromium`。测试会自行启动本地页面。
