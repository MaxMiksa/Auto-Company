# 家族共忆

一份可以在本地浏览器完成的家庭故事手册：自愿署名讲述，互问补充，保留分歧，共同留下可追溯原话的故事。

```sh
npm start
```

需要 Node.js 20 以上；在本目录运行后打开 <http://127.0.0.1:4187>。无需账号或服务。完整流程、保存恢复与隐私边界见 [DELIVERY.md](DELIVERY.md)。

同一设备轮流参与；浏览器本地保存，完整JSON备份包含私密材料。共同故事Markdown排除私密内容，已导出旧副本不能被撤回。

## 开发检查

运行 `npm ci` 后，`npm test` 执行核心与恢复检查；`npm run test:browser` 执行真实 Chromium 流程。首次测试请运行 `npx playwright install chromium`。测试会自行启动本地页面。
