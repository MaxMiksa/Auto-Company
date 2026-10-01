# 迁移验收工作台

为独立 CRM 实施顾问提供本地浏览器验收：导入源/目标 CSV，配置身份、字段和关联映射，逐条定位异常，保留不可判定范围，导出验收证据。全部业务数据在浏览器中处理；不需要账户或外部服务。

启动：安装 Node.js 22 或更新版本，在此目录运行 `npm start`，打开 <http://127.0.0.1:8765>。Windows、macOS、Linux 均可使用。请使用现代 Chromium、Edge 或 Firefox 浏览器。不要直接双击 HTML，浏览器的模块和文件哈希需要本机 HTTP 入口。

先点击任一明确标记的合成样例了解流程，再上传自己的 UTF-8 CSV。样例不是真实用户或真实迁移证据。

| 资料 | 用途 |
|---|---|
| [完整使用说明](docs/USAGE.md) | 字段映射、身份重编号、金额精度、关联角色、缺证与恢复 |
| [交接文件](DELIVERY.md) | 启动、检查、适用范围与保管方式 |
| [实现说明](docs/fullstack/IMPLEMENTATION.md) | 核验规则及代码接口 |

运行核验检查：`npm test`。运行真实浏览器检查需先 `npm ci`、`npx playwright install chromium`，保持本机服务器运行，再设置 `PRODUCT_PREVIEW_URL=http://127.0.0.1:8765` 并执行 `npm run test:browser`。PowerShell 设置方式为 `$env:PRODUCT_PREVIEW_URL='http://127.0.0.1:8765'`；POSIX 终端可将 `PRODUCT_PREVIEW_URL=http://127.0.0.1:8765` 写在命令前。测试材料全部为合成数据。

工作台只验证所选字段与所给材料。完整导出、授权、快照与身份声明由使用者负责；真实 CRM 迁移、用户采用、付费和盈利尚未验证。历史机会评估和 DataComPy 实验留在原运行，未随独立副本公开；本次展示没有改写原商业结论。
