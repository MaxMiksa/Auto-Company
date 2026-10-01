# 公开示例 / Public examples

这里保存 22 个经人工授权公开的产品快照：14 个后续产品、4 个选出的历史产品与4个既有公开示例。它们展示实际可运行的软件与各自边界；没有把构造演示、软件测试或周期完成写成真实采用、成交或盈利。

These 22 human-authorized source snapshots comprise 14 continuation products, four selected historical products and four previously published examples. Synthetic demonstrations, software checks and completed cycles do not establish customer adoption, revenue or real-world effectiveness.

## 打开方式 / Local use

先进入对应目录。表中的 **Static PORT** 表示在该目录执行下面的静态服务命令，将 `8080` 换成表中端口，然后打开 `http://127.0.0.1:PORT/`。Windows 使用 `python`，macOS/Linux 使用 `python3`。按 `Ctrl+C` 停止；端口占用时选另一空闲端口。

Enter the example's directory first. **Static PORT** means serve that directory with the command below, replacing `8080` with its listed port. Open `http://127.0.0.1:PORT/`; stop with `Ctrl+C`. Use `python3` on macOS/Linux and another free port if needed.

```sh
python -m http.server 8080 --bind 127.0.0.1
```

**npm start** 的运行依赖与端口见各项目 README；这些原生前端无需构建。三个 Python 后端使用各自的服务入口。支付审计是 CLI，没有网页。开发测试需要的 Playwright 不属于产品运行依赖。

For **npm start**, see the linked README for runtime requirements and port; these native frontends need no build. The three Python backends have their own server entrypoints. Payment Recovery Audit is a CLI. Playwright is a development-test dependency.

## 任务与边界 / Tasks and limits

| 产品 / Example | 用户任务 / Task | 启动 / Start | 主要边界 / Key limit | 来源 / Provenance |
| --- | --- | --- | --- | --- |
| [规格证据台 / Spec Evidence](spec-evidence/) | 比较采购规格，留下原文与人工复核 / Compare specifications with source evidence | `npm start` · 8080 | 不替代采购或工程批准 / No procurement or engineering approval | [B-public-open-1](SOURCES.md#spec-evidence) |
| [量源复核 / IFC Source Preflight](ifc-source-preflight/) | 核对 IFC 数量、单位与材料来源 / Inspect IFC quantity provenance | [Python 环境与 server.py](ifc-source-preflight/README.md) · 8765 | 使用已有数量，不重算几何 / Existing quantities, no geometry recalculation | [B-public-open-2](SOURCES.md#ifc-source-preflight) |
| [一桌双味 / Dual Flavor Table](dual-flavor-table/) | 一次备料，安排两组口味的整餐 / Plan a shared dinner with two flavors | Static 8080 | 未经真实厨房试做；不保证无过敏原 / No kitchen or allergy validation | [B-public-consumer-1](SOURCES.md#dual-flavor-table) |
| [迁移验收工作台 / CRM Migration Proof](crm-migration-proof/) | 核对 CSV 身份、字段和关联迁移 / Review CRM CSV migration evidence | `npm start` · 8765 | 只验证所给材料与声明 / Limited to supplied data and claims | [B-public-professional-1](SOURCES.md#crm-migration-proof) |
| [触图审查台 / Tactile Preflight](tactile-preflight/) | 阅读触觉 SVG 关系，修改标签，记录复核 / Review tactile SVGs | `python serve.py` · 8765 | 人工审查工具，无触觉教学效果保证 / No tactile-learning validation | [B-confirm-spending-2](SOURCES.md#tactile-preflight) |
| [交错岛 / Crossed Island](crossed-island-experiment/) | 两人轮流创造、交换条件、共同取舍 / Create and choose together | Static 8080 | 同设备轮流，封存不加密；可随时停 / Local handoffs, no encrypted sealing | [B-confirm-experience-2](SOURCES.md#crossed-island-experiment) |
| [归档验收台 / Field Return Audit](field-return-audit/) | 核对离线采集、SQLite/GeoPackage 与附件回传 / Audit field-data returns | `python server.py --port 8765` | 本机处理，不证明真实业务采集完整 / Local checks, no business-completeness guarantee | [B-confirm-access-2](SOURCES.md#field-return-audit) |
| [图证工作台 / Chart Proof](chart-proof/) | 制作带数据状态和复核证据的图表阅读资料 / Build traceable chart reading material | `npm start` · 8080 | 缺测与近似需显式标记；人工复核 / Missing/estimated data stays explicit | [B-confirm-change-2](SOURCES.md#chart-proof) |
| [栖改 / Reversible Room](reversible-room/) | 比较租客改善方案、成本、观察与搬迁 / Plan reversible room improvements | Static 8765 | 规划估算，无安装或降温保证 / Estimates, no installation/effect guarantee | [B-third-choice-3](SOURCES.md#reversible-room) |
| [缓步 / Rest Rhythm](rest-rhythm/) | 按恢复节奏安排一天，保留现场调整 / Plan a day with recovery breaks | Static 8080 | 不提供实时地点、空座或路线保证 / No live venue, seating or route guarantee | [B-third-personal-3](SOURCES.md#rest-rhythm) |
| [家族共忆 / Family Memory](family-memory/) | 自愿讲述与互问，留下可追溯原话的故事 / Record voluntary family stories | `npm start` · 4187 | 私密资料需自行保管；旧导出无法撤回 / Private backups, exports cannot be recalled | [B-third-together-3](SOURCES.md#family-memory) |
| [参途 / Participation Recovery](participation-recovery/) | 演练参加路径，记录变更、确认与交接 / Rehearse participation and recover changes | `npm start` · 4189 | 软件演练不等于现实活动成功 / Rehearsal is not real-event validation | [B-third-whole-3](SOURCES.md#participation-recovery) |
| [披露双检 / Disclosure QA](disclosure-qa-spike/) | 本机检查 PDF 必须删、必须留与人工复核 / Check PDF disclosure rules | [WSL/Linux 安装与 server.py](disclosure-qa-spike/README.md) · 8765 | 不修改 PDF，不认证安全/合规；扫描件需人工 / No redaction or compliance certification | [B-confirm-open-1](SOURCES.md#disclosure-qa-spike) |
| [家里的小展会 / Family Art Show](family-art-show/) | 孩子选作品、定顺序、主持家庭小展 / Arrange a child-led home art show | `npm start` · 4188 | 本机图片与文字；无评分或教育效果承诺 / Local media, no educational-effect claim | [B-confirm-consumer-1](SOURCES.md#family-art-show) |
| [ScopeFence](scopefence/) | 分享范围变更与费用、工期决定 / Share a scope-change decision | Static 8000 | 链接可改写，不是认证批准 / Editable link, no authenticated approval | [来源 / Source](scopefence/SOURCE.md) |
| [图检单 / Image Batch Check](tujiandan/) | 核对图片尺寸、体积、格式与命名 / Check image delivery batches | `npm start` · 8000 | 不修改原图；示例规则非行业标准 / No image edits or industry-standard claim | [来源 / Source](tujiandan/SOURCE.md) |
| [保单跟进台 / COI Chase Desk](coi-chase-desk/) | 记录资料请求、已做联系与收件出处 / Track insurance-document requests | Static 8000 | 仅本次会话，不发消息、不认证保险 / Session-only, no sending or insurance validation | [来源 / Source](coi-chase-desk/SOURCE.md) |
| [Payment Recovery Audit](payment-recovery-audit/) | 审计失败账单机会与观测净付款 / Audit failed-invoice opportunities | `npm run demo:audit` · Node ≥18 | 只读构造文件，不连接 Stripe、不移动资金 / Fixture-only, no Stripe calls or fund movement | [来源 / Source](payment-recovery-audit/SOURCE.md) |
| [行间 / TableDelta](tabledelta/) | 按唯一键比较两份 CSV，下载变化原值 / Compare CSVs by a unique key | Static 8765 | 键须唯一；不是数据库迁移或自动修复 / Unique keys required, no migration or repair | [既有公开来源 / Published source](tabledelta/README.md#项目来源) |
| [幕检 / CueCheck](cuecheck/) | 检查、逐条编辑并导出 SRT / Review and edit SRT subtitles | Static 8766 | 阅读负担为复核提示；不保证播放体验 / Reading-load prompts, no playback guarantee | [既有公开来源 / Published source](cuecheck/README.md#项目来源) |
| [Text Meter](text-meter/) | 统计 Unicode 字符、空白分词与行数 / Count Unicode text and lines | Static 8000 | 字符为码点，词按空白切分 / Code points, whitespace-separated words | [来源 / Source](text-meter/SOURCE.md) |
| [范围确认单 / Scope Sheet](scope-sheet/) | 填写范围与报价，导出中文确认单 / Prepare a Chinese scope note | Static 8000 | 确认单草稿，不提供法律批准 / Draft note, no legal approval | [来源 / Source](scope-sheet/SOURCE.md) |

## 来源与保存 / Provenance and preservation

14 个后续产品的原运行标识见 [SOURCES.md](SOURCES.md)，选出的历史产品有各自来源说明。原始运行记录保持不变；本次公开副本中的设计、可运行性、翻译与缺陷修复是后续人工授权工作，不增加历史自主轮次。四个旧公开示例从原 `projects/` 展示目录迁入，SnapOG 历史资产仍留在 [projects/snapog](../projects/snapog/)。

The 14 continuation sources are listed in [SOURCES.md](SOURCES.md); selected historical products have individual source notes. Original run records remain unchanged. Publication refinements are later human-authorized work, not extra historical autonomous cycles. Four earlier public examples moved here from `projects/`; the preserved SnapOG asset remains in [projects/snapog](../projects/snapog/).

公开快照不包含嵌套 Git、凭据、模型记录、本机身份/治理状态、运行日志或私有发布历史。新自主产品仍在 [projects/](../projects/)，属于独立本机仓库；它们不会自动加入本目录或框架 GitHub 仓库。

Public snapshots exclude nested Git, credentials, model records, local identity/governance state, logs and private release histories. Newly generated products remain independent local repositories under [projects/](../projects/) and are not automatically published here.
