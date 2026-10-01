# 交错岛 · 双人叙事手册

两个人轮流使用同一设备，各自创造灯塔与花园，进入对方设定的环境，最后共同决定保留原物还是修复离岛的路。支持暂停、部分作品留存、JSON 备份恢复、纪念页导出与纸面体验包。

在本目录执行 `npm start`，打开 [本机体验](http://127.0.0.1:8080)。也可运行 `python -m http.server 8080 --bind 127.0.0.1`；macOS / Linux 使用 `python3`。不需要构建、账户或联网服务。纸笔体验见 [printable.html](printable.html)。

开发检查：

```sh
npm ci
npx playwright install chromium
npm run test:engine
npm run test:browser
```

完整玩法、数据边界与恢复方式见 [DELIVERY.md](DELIVERY.md)。屏幕封存依靠双方约定；本机存档和备份包含双方文字，没有加密或在线同步。任何时候都可以停止，不需要讲真实往事。

原实验卡片与构造输入保留在 [cards/SHARED.md](cards/SHARED.md) 和 [sample.json](sample.json)。`python experiment.py --out experiment-results.json` 只做规则回放，不代表真人体验。未验证娱乐效果、完成时间、关系效果、付费意愿或商业收益。
