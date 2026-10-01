# 功能与浏览器检查

在产品目录运行。测试仅使用虚构人物与事件，不代表现实用户体验。

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

核心检查覆盖署名、互问、分歧、可追溯故事、撤回、私密数据边界及非法备份。真实 Chromium 检查覆盖四步可见操作、实际下载、回应草稿独立保存、打印内容、持久化、失败恢复、手机布局，以及页内确认的 Escape 取消和焦点回归。

浏览器检查自行启动 `http://127.0.0.1:4187`，结束后停止；无需另开预览。`npm start` 可用于日常打开。端口改变后，本机存储不会自动迁移，请先导出备份。

配置支持 `FAMILY_MEMORY_BROWSER` 指定已有 Chromium 可执行文件。失败截图与追踪保存在 `.auto-company/browser-results/`。页内确认通过可见按钮完成；打印内容检查使用浏览器打印样式，不能作为实体打印机验收。
