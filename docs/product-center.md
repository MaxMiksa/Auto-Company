# Product center / 多产品管理中心

The local product center groups recorded products from explicitly registered directories. Viewing a product changes the reading scope only. Its journal preserves product identities, continuous round numbers and recorded outcomes.

本地产品中心集中展示明确接入的目录中的产品。切换产品只改变查看对象；工作记录继续使用原产品身份、连续轮次和真实执行结果。

## Start / 启动

```bash
python3 dashboard/center_server.py --port 8810
```

Windows:

```powershell
.\scripts\windows\center-win.ps1 -Port 8810
```

Open `http://127.0.0.1:8810/center`. Existing `make dashboard` and `/journal` retain the single-runtime interface. The center's legacy journal view is read-only; its controls use scoped center requests.

打开 `http://127.0.0.1:8810/center`。原来的 `make dashboard` 仍提供单运行目录界面；中心中的旧记录视图只读，执行操作使用明确绑定产品的中心请求。

Use **Import existing product / 接入已有产品** to inspect a complete run directory. It initially grants read access only. You can also explicitly register a source at startup:

```bash
python3 dashboard/center_server.py --source /absolute/path/to/a/run
```

接入的应是包含原始身份账本、日志等记录的运行目录。只有公开源码的副本不能冒充完整运行档案，也不能通过查看页面自动启动模型或产品预览。

Source-only directories can be explicitly registered as references. References can expose a verified README, but do not count as products or gain execution permission. Refresh discovers newly registered products only inside roots you have already connected; it does not scan the rest of your computer.

只有源码的目录可以明确登记为参考资料，阅读经过校验的 README；它不计入产品数，也不能执行。自动刷新只在已接入的根目录中发现新登记产品，不扫描整台电脑。

## Execution and queue / 执行与队列

The first version uses one managed execution domain and one model slot. On Windows, explicitly choose the WSL distribution and user:

```powershell
.\scripts\windows\center-win.ps1 -WslDistribution Ubuntu -WslUser your-user
```

Without a configured execution domain, Windows can still read registered sources. Engine CLIs, authentication and media dependencies must already be available in the selected domain. The center does not install them or switch accounts.

Windows需要明确的WSL发行版与用户才能运行任务；未配置时仍可阅读已接入档案。引擎、账号和媒体依赖由现有环境提供，中心不自动安装或切换账号。

- **View / 查看** never changes the active execution target.
- **Start now / 立即开始** explicitly runs one request when no earlier task owns the slot. **Enqueue / 加入队列** persists the request and waits for queue dispatch to be enabled.
- **Pause queue / 暂停队列** prevents subsequent starts without interrupting the current work. **Stop this item / 停止此项** waits for that request's owned processes to finish. **Stop all / 全部停止** also pauses dispatch.
- One request owns the slot for its entire auto-loop, including cleanup. A cycle ending is not a product finishing. A long-running product can keep other requests waiting; there is no implicit cycle cap or estimated wait time.
- Restarting the center pauses new dispatch and reconciles existing ownership. Uncertain launches are not automatically repeated. Budget or governance pauses remain protected.

一次请求持续占用执行位置直到整个循环停止并清理完成，不会在每轮结束时自动切换产品。队列不设置隐含的轮数上限或商业完成条件。重启默认暂停派发；无法确认的启动或停止需要核对，不自动重放。已有预算和人类约束保护继续生效。

An unresolved P1 in the original consensus prevents a new start. If the original guard pauses a loop that is already alive, the center shows a protection pause while retaining that request's slot and Stop action. It does not clear P1, resolve the decision or stop the loop automatically. Expired live observations become unknown.

原共识中存在未解决的 P1 时，中心拒绝新启动。如果原保护规则让已启动的循环暂停，中心显示保护暂停，但该请求仍持有执行位置，停止按钮仍可用。中心不会清除 P1、代做决定或自动停止循环；实时证据过期后显示未知。

## Existing data and capabilities / 旧数据与能力

An imported archive stays read-only until a compatible, unambiguous runtime is explicitly taken over. A run directory that contains several historical products does not necessarily contain independent resumable contexts for each. Missing, conflicting or unsupported sources cannot execute. The center does not merge diverged ledgers or infer old consensus from the newest report.

旧运行根内的多个历史产品不一定各自拥有可恢复的共识与配置。兼容、归属明确的完整上下文才能被明确接管；缺失、冲突或不兼容来源只读。取消归档不增加执行权限，解除登记不删除源码。

Before starting work, the center verifies the selected product identity, registration and independent repository again. If those records no longer agree, restore the source through an explicit reviewed recovery before submitting a new request. The center preserves history and does not silently repair registration, clear protective pauses or replay the failed request. Stopping owned work and releasing control remain separate from permission to start.

开始工作前，中心再次核对所选产品的身份、登记和独立仓库。记录不一致时，需要明确核对并恢复来源，再提交新请求；中心保留历史，不自动补登记、清除保护暂停或重放失败请求。停止所属任务、解除托管与启动资格分别判断。

Source management keeps selection, takeover, release and preview actions explicit. Supported managed static websites can start or stop an owned preview and retry screenshot capture. Release first confirms that owned previews have stopped. Unsupported formats or missing dependencies remain unavailable with a reason. Capture does not create a new model request.

来源管理提供明确的选择、接管、解除接管和预览操作。受管且受支持的静态网页可以启动、停止预览或重新截图；解除接管前须确认所属预览已停止。不支持的格式或缺少依赖会说明原因，截图本身不新建模型请求。

Reported titles, summaries and phases remain model-authored records. The center parses them deterministically without a second AI summarizer. Checks, screenshots and process results are evidence with limited scope, not automatic certification that a product is complete or commercially successful. Unknown usage is not zero usage.

标题、摘要和阶段仍是模型填写的结构化记录；程序直接解析，不加第二个AI解释器。检查、实拍与进程结果各有适用范围，不等于产品已完成或商业化成功。缺失用量保持未知。

Product language is attributed from program-recorded configuration for an actual product cycle. Older archives without that evidence remain unknown, even if their current root language preference is available. Changing the center language translates interface labels, not recorded reports or product pages.

产品语言取自实际产品轮次的程序配置记录；旧档案没有该证据时保持未知，不能拿当前根目录语言偏好倒推历史。切换中心语言只翻译界面固定文案，不改写历史汇报或产品页面。

## Local state and recovery / 本地状态与恢复

Default center state locations:

| System | Directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%/AutoCompany/center` |
| macOS | `~/Library/Application Support/AutoCompany/center` |
| Linux | `${XDG_STATE_HOME:-~/.local/state}/auto-company/center` |

`--data-dir` selects an explicit local directory. Do not put an active database on network or cloud-synchronized storage. Only one center process can own a data directory. The center database stores registration, requests and control history; the original runtime remains authoritative for product identities and cycles.

`--data-dir`可指定本地目录，不支持把活跃数据库放在网络盘或云同步目录。中心数据库与原产品账本职责分开；重新登记来源可以恢复显示，但不能凭日志猜测未完成请求。回退前先停稳受管工作和所有写入者，保留新增轮次，不恢复旧计数器覆盖新数据。

Managed roots reject legacy controls; release ownership through the center only after work has stopped. This coordinates compatible registered roots in the selected execution domain. It is not a machine-wide sandbox preventing arbitrary older clones from running.

接管后的运行根拒绝旧入口控制，停稳后才能通过中心解除接管。此机制只协调明确执行域内已接管的兼容目录，并不阻止用户在其他目录自行运行旧版本。
