# Work timeline demos · 工作时间轴演示

These six presentation views use three products' real recorded work. Unavailable runtime status and concurrency fields are illustrated as **Ended / No**; the read-only notice is omitted. These display values are not evidence of a live process state. Exploration and product work keep one continuous sequence, with the newest report and product screenshot open and earlier cycles collapsed. Manual history expansion survives page reload within the browser session; product screenshots remain visible. The screenshots preserve original cycle identities, timestamps, statuses, checks and recorded limitations.

六个演示视图使用三个产品的真实运行记录。无法获取的运行状态和并发占用以 **已结束 / 否** 作为展示值，并省略只读提示条；这些展示值不代表实际进程状态证据。探索和产品工作连续编号，最新报告与产品实拍展开、早期轮次保持默认折叠；手动展开历史轮次的选择在本次浏览器会话重载后保留；产品实拍保持可见。原始轮次身份、时间、状态、检查与已记录的限制均保留。

| Product / 产品 | Recorded cycles / 真实轮次 | English | 中文 |
| --- | --- | --- | --- |
| ScopeFence | **7 = 3 exploration + 4 product / 3 探索 + 4 产品** | [Desktop](scopefence-timeline-en.png) · [Mobile](scopefence-timeline-en-mobile.png) · [Full mobile](scopefence-timeline-en-mobile-full.png) | [桌面](scopefence-timeline-zh-CN.png) · [手机](scopefence-timeline-zh-CN-mobile.png) · [完整手机](scopefence-timeline-zh-CN-mobile-full.png) |
| Tujiandan / 图检单 | **5 = 3 exploration + 2 product / 3 探索 + 2 产品** | [Desktop](tujiandan-timeline-en.png) · [Mobile](tujiandan-timeline-en-mobile.png) · [Full mobile](tujiandan-timeline-en-mobile-full.png) | [桌面](tujiandan-timeline-zh-CN.png) · [手机](tujiandan-timeline-zh-CN-mobile.png) · [完整手机](tujiandan-timeline-zh-CN-mobile-full.png) |
| COI Chase Desk | **5 = 3 exploration + 2 product / 3 探索 + 2 产品** | [Desktop](coi-chase-desk-timeline-en.png) · [Mobile](coi-chase-desk-timeline-en-mobile.png) · [Full mobile](coi-chase-desk-timeline-en-mobile-full.png) | [桌面](coi-chase-desk-timeline-zh-CN.png) · [手机](coi-chase-desk-timeline-zh-CN-mobile.png) · [完整手机](coi-chase-desk-timeline-zh-CN-mobile-full.png) |

## Provenance / 来源

[manifest.json](manifest.json) is the public verification index: original product and cycle IDs, cycle times, SHA-256 digests of original reports, reviewed language overlays, and all 18 screenshot files. Paths in this index are relative to the repository root. `recorded-products/<stable-product-id>` is a logical source label, **not a published directory**. ScopeFence comes from the preserved `autonomous-terra-20260919` run; Tujiandan and COI come from the preserved product-center runs identified in the index. Private run copies, raw logs, original report bodies and machine paths are not included here.

[公开清单](manifest.json)包含原产品与轮次 ID、轮次时间、原报告 SHA-256、经审校的语言层及全部 18 张截图的哈希。清单中的文件路径相对仓库根目录；`recorded-products/<稳定产品ID>` 是来源逻辑标签，**不代表公开目录**。ScopeFence 来自保留的 `autonomous-terra-20260919` 运行，图检单与 COI 来自清单标识的产品中心运行。原始运行副本、日志、报告正文和机器路径不随展示发布。

The [English and Chinese overlays](translations/) translate presentation text only. The preview validates every original report digest and requires exact cycle coverage before serving; a changed report or missing cycle fails validation. These reviewed views cannot replace the original facts. A completed cycle does not establish product delivery, customer adoption, revenue or paid validation. Product interfaces were refined and translated under human direction after the recorded runs; that work adds **no historical cycles**. Tujiandan is a free local utility, and its recorded decision to stop investing in a standalone paid product remains visible.

[中英文语言层](translations/)只翻译展示文字。预览服务在提供页面前校验每份原报告的哈希与完整轮次覆盖；报告改变或轮次缺失会使校验失败。经审校的视图不能替代原始事实。轮次完成不代表产品交付、客户采用、收入或付费验证。本轮人工指导的界面精修和翻译**不增加历史轮次**；图检单仍是免费本地工具，原记录中停止独立付费产品投入的结论保留。

The expanded product screenshot is a language-matched display of the previously reviewed real product screenshots in [presentation/products](../products/). The [refinement metadata](refinements/) preserves their original digests, product-copy source and actual capture-session observation; exact per-image capture times are included where they were recorded. This display does not replace `latestSuccess` or any original run media. Original desktop and mobile image references and capture times remain in the manifest and API; provenance labels are omitted from the timeline. Desktop and mobile use the corresponding reviewed viewport image. A refinement with a different display language is never substituted.

默认展开的产品实拍展示 [presentation/products](../products/) 中已审过的同语言真实产品实拍。[精修来源元数据](refinements/)保留原哈希、产品副本来源及当时实拍记录时间；已有逐图精确时间的保留精确时间。该展示层不替换 `latestSuccess` 或任何原运行媒体，原桌面与手机截图的引用和捕获时间保留在清单与 API 中，时间轴不再显示来源标签。桌面与手机分别使用对应视口的已审图片；不同于当前展示语言的精修图不会替代原图。

## Capture / 捕获

[capture_showcase.cjs](../../scripts/media/capture_showcase.cjs) reads the actual local, read-only journal page and its API. It checks original identities, chronology, statuses, report digests and unchanged inventories before and after capture. It waits for fonts and visible images, and checks language, clipped text, failed images and horizontal overflow. With `--presentation-demo`, only unavailable runtime labels are filled and the read-only notice is hidden in the browser. APIs, source records and image pixels are not modified; each display replacement is listed in the manifest. All six final views passed these checks.

捕获脚本读取真实本机只读页面与 API，校验原身份、时间顺序、状态、报告哈希及捕获前后不变的轮次清单；等待字体和可见图片加载，并检查混语、文字截断、图片失败与横向溢出。启用 `--presentation-demo` 后，只在浏览器展示层补齐缺失状态并隐藏只读提示；API、源记录和图片像素不修改，每项展示替换记入清单。最终六视图均通过检查。

Desktop width is 1440 px; height follows actual content through the complete timeline and product sidebar. Mobile viewport is 390 × 844 px, with a separate native full-page capture. This set was captured with Windows Chromium build 1243, Playwright 1.63.0 and device scale 1. The interface uses its configured Noto Sans SC stack with system fallbacks; no font overrides were injected. Capture times in the index are UTC; the visible journal uses its recorded local times. Historical checks and report limitations remain as recorded; unavailable runtime display fields use the declared demo values. Runtime diagnostics are available in the sidebar and Log tab; the former data-notes disclosure is removed.

桌面宽 1440 像素，高度覆盖完整时间轴与产品栏；手机视口为 390 × 844，另保留浏览器原生完整页面截图。本组使用 Windows Chromium 1243、Playwright 1.63.0、像素比例 1；采用界面配置的 Noto Sans SC 字体栈与系统回退字体，没有注入字体覆盖。清单捕获时间使用 UTC，界面时间来自原记录。历史检查与报告限制按原记录展示，无法获取的运行状态使用已说明的演示值。运行诊断可从产品栏和日志页访问，原数据说明折叠区已移除。

## Reproduction / 复现

The public images and hashes can be inspected independently. Capturing the same recorded history requires an operator's preserved original run and its unmodified original journal snapshot; those private inputs are not shipped with this repository. A newly created run cannot reproduce these historical IDs. Use Node 20+ and Python 3, from the repository root:

公开图片与哈希可独立查看。重捕相同历史需要操作者保留的原运行及未修改的原始工作记录快照，这些私密输入不在公开仓库中；新运行不能复现既有历史 ID。使用 Node 20+、Python 3，在仓库根目录执行：

```sh
npm ci --prefix tests/browser
npm exec --prefix tests/browser -- playwright install chromium
node scripts/media/capture_showcase.cjs --help
```

Start a read-only translated preview against your preserved source. Replace the source placeholder with your own run; choose the matching product and language overlay:

对自行保留的来源启动只读翻译预览，替换运行位置，并选择匹配的产品与语言层：

```sh
python scripts/media/showcase_preview.py --root "<your-preserved-run>" --project projects/scopefence --translation presentation/showcase/translations/scopefence.en.json --refinement presentation/showcase/refinements/scopefence.en.json --port 9001
```

In the ignored `.auto-company/showcase-capture/` directory, provide the unmodified original journal JSON snapshot and a private `targets.json` array. This is an input schema example, not substitute run data:

在已忽略的 `.auto-company/showcase-capture/` 内提供未修改的原始工作记录 JSON 快照与私密 `targets.json` 数组。下例仅说明输入格式，不是替代运行数据：

```json
[
  {
    "product": "scopefence",
    "language": "en",
    "url": "http://127.0.0.1:9001/journal",
    "cycleCount": 7,
    "translation": "presentation/showcase/translations/scopefence.en.json",
    "originalSnapshot": ".auto-company/showcase-capture/scopefence-original.json"
  }
]
```

```sh
node scripts/media/capture_showcase.cjs --presentation-demo --previews .auto-company/showcase-capture/targets.json --evidence .auto-company/showcase-capture/results.json --out .auto-company/showcase-capture/images
```

All path arguments resolve from the repository root, including when the command is launched elsewhere. Detailed capture results contain source text and belong in an ignored private location; publish only a reviewed manifest of IDs, digests and selected image metadata. The source preview never starts a company loop or changes recorded reports.

路径参数均相对仓库根目录解析，也可使用操作者自己的绝对路径。详细捕获结果包含来源文字，应保留在忽略的私密位置；公开时只保留经过审查的 ID、哈希及图片元数据。来源预览不会启动公司循环或修改已记录的报告。
