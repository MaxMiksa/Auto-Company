# 本地交付说明

已实现：展会配置；多作品本地图片/无图原作输入；孩子原话保留；默认暂不展示与自主入展；顺序调整及编辑删除；逐件主持、跳过、暂停、结束；最多 20 场文字回顾；完整展签、主持说明和回顾打印；本机保存状态；含图片 JSON 备份恢复；破坏性操作确认；合成示例显式选择。

打开方式和完整操作请见 [README.md](./README.md)。源码入口为 `index.html`，样式 `styles.css`，行为 `app.js`。全部运行资源在本目录；网页不请求外部字体、图片、服务或接口。页面标识与 favicon 使用本目录的 `icon.svg`。

## 数据恢复与边界

数据版本 1，浏览器存储键 `family-art-show.v1`。保存失败保留当前内存数据并可导出；损坏原记录不被自动空白覆盖。恢复必须通过全部结构与图片校验，再确认覆盖，且成功写入本机存储后才替换页面状态。

私人备份包含暂不展示作品与所有历史文字。删除和撤回会隐藏对应回顾和打印内容；再次把同一作品入展，其历史文字可重新显示。回顾仅呈现当时文字，不用当前图片冒充旧场图片。原作与原始照片需由家庭保留，网页压缩图不是原件档案。历史上限与图片/文件容量限制见 README。

此产品不宣称已实现家庭教育结果、真实家庭采用或商业收益。`file://` 本机存储随浏览器行为而异；固定 loopback 地址加备份是建议使用方式。浏览器打印可存 PDF，实体打印机与真实家庭活动未验证。

## 技术检查与证据

QA 将真实浏览器测试放在 `tests/`，覆盖核心操作、图片构图与文字、恢复覆盖、错误输入、存储故障、键盘和窄屏。测试是开发依赖，不是运行依赖。

在产品目录准备开发检查（运行产品本身无需安装这些开发依赖）：

```sh
npm ci
npx playwright install chromium
npm test
```

如已提供本机 Chromium，可使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/绝对路径/chromium npm test`，省去浏览器下载。Linux 浏览器缺少系统库时，按 Playwright 的安装提示补齐。

浏览器检查会自行启动本机页面；不需要 Auto Company 运行环境。结果在 `.auto-company/checks/`，截图与失败追踪在 `.auto-company/browser-results/`。这些均为虚构材料的软件检查，不是现实家庭体验或实体打印验收。

## 稳定操作接口

| 流程 | DOM 标识 |
| --- | --- |
| 展会配置 | `show-title` / `host-name` |
| 作品表单 | `artwork-form` / `art-title` / `art-words` / `art-image` / `art-included` / `art-excluded` / `save-artwork` |
| 作品列表 | `artwork-list`，每件 `.artwork-row[data-art-id]`，按钮 `data-action=edit/toggle/up/down/delete` |
| 主持 | `start-show` / `stage-art` / `stage-title` / `stage-words` / `host-note` / `host-next` / `host-skip` / `host-pause` / `host-end` |
| 回顾和打印 | `review-list` / `print-show` / `print-document` |
| 备份与恢复 | `export-backup` / `import-backup` / `reset-show` / `load-demo` |
| 保存和错误状态 | `save-status` / `notice` / `form-error` |

所有用户文本通过 DOM `textContent` 或表单 `value` 展示，未拼接入 HTML。备份拒绝外部图片 URL、SVG、脚本 URL、未知字段、重复 ID、不支持版本与不一致的主持关系；导入图片经签名与真实浏览器解码校验。
