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

The center uses one managed execution domain with independent project owners. It runs up to four projects concurrently by default. In the existing work queue, change **Concurrent projects** or select **Unlimited**. Reducing the number does not interrupt active work; new requests wait until capacity becomes available. On Windows, explicitly choose the WSL distribution and user:

```powershell
.\scripts\windows\center-win.ps1 -WslDistribution Ubuntu -WslUser your-user
```

Without a configured execution domain, Windows can still read registered sources. Engine CLIs, authentication and media dependencies must already be available in the selected domain. The center does not install them or switch accounts.

Windows需要明确的WSL发行版与用户才能运行任务；未配置时仍可阅读已接入档案。引擎、账号和媒体依赖由现有环境提供，中心不自动安装或切换账号。

- **View / 查看** never changes the active execution target.
- **Start work / 开始运行** authorizes the submitted work to start in queue order when capacity is available. **Enqueue / 加入队列** persists the request and waits for queue dispatch to be enabled. Starting a batch does not authorize other paused requests ahead of it.
- **Pause queue / 暂停队列** prevents subsequent starts without interrupting the current work. **Stop this item / 停止此项** waits for that request's owned processes to finish. **Stop all / 全部停止** also pauses dispatch.
- Each request owns its project for the entire auto-loop, including cleanup. A cycle ending is not a product finishing. Continuous projects can keep all capacity occupied and later requests waiting; there is no implicit cycle cap or estimated wait time.
- Restarting the center pauses new dispatch and reconciles existing ownership. Uncertain launches are not automatically repeated. Budget or governance pauses remain protected.

默认同时运行 4 个项目，在原有工作队列中调整数量或选择不限；调低不会中断已启动的项目。一次请求持续占用项目及执行位置直到整个循环停止并清理完成，不会在每轮结束时自动切换产品。队列不设置隐含的总时长、轮数上限或商业完成条件。重启默认暂停派发；无法确认的启动或停止需要核对，不自动重放。已有预算和人类约束保护继续生效。

Pause and Stop all also revoke earlier Start now authorizations that have not launched, including work still being prepared. Preparation may finish, but it cannot silently restore that authorization. An owned request in an attention state keeps its Stop action; an unlaunched request does not claim a process to stop.

暂停队列和全部停止也会撤销尚未启动的“立即开始”授权，包括仍在准备中的工作。准备过程可以完成，但不会重新获得旧启动授权。已经拥有执行进程的待核对请求仍提供停止操作，未启动的请求不会被当作运行中进程。

The direction for new work can be left empty for autonomous exploration. Preparation and any preparation failure remain visible in the queue after a page reload, separately from model execution requests. Checking that record does not retry or start a model.

新建工作的方向可以留空，由原流程自主探索。准备状态和准备失败原因会保留在队列中，重新打开页面仍可查看，并与模型执行请求区分。核对准备记录不会重试或启动模型。

An unresolved P1 in the original consensus prevents a new start. If the original guard pauses a loop that is already alive, the center shows a protection pause while retaining that request's slot and Stop action. It does not clear P1, resolve the decision or stop the loop automatically. Expired live observations become unknown.

原共识中存在未解决的 P1 时，中心拒绝新启动。如果原保护规则让已启动的循环暂停，中心显示保护暂停，但该请求仍持有执行位置，停止按钮仍可用。中心不会清除 P1、代做决定或自动停止循环；实时证据过期后显示未知。

A project-specific P1, budget pause or failed preflight affects that project only. Its ownership remains held until cleanup is confirmed; other projects can continue. A shared provider pause or unavailable execution environment pauses new dispatch without stopping unrelated running work. Legacy single-owner contexts retain their conservative recovery behavior and cannot overlap new project owners.

新运行中的单项目 P1、预算暂停或启动检查失败只影响该项目，其他项目可继续；清理未确认前不释放所属执行位置。共享服务商限流或执行环境不可用时暂停新派发，不自动停止其他正在运行的项目。旧单槽上下文保留原恢复规则，与新项目执行互斥；不会自动迁移旧运行。

## Batch creation and configuration templates / 批量创建与配置模板

Use the existing **New work** dialog. Each configuration group has its own engine, model, reasoning effort, new-product language, project count and optional direction. Add another group to submit, for example, two high and two xhigh projects together. Each project receives an independent runtime. A batch accepts up to 100 projects per submission; this does not cap the number of running or queued projects. All intents and configuration snapshots are registered atomically before preparation starts. Retrying the same submission does not duplicate projects. Individual preparation failures remain visible; pause, stop-all and restart revoke outstanding start authorizations while preserving prepared work in the queue.

在原有“新建工作”窗口添加配置组，每组分别选择引擎、模型、思考强度、新产品语言、数量及可留空方向。例如一组 high × 2，另一组 xhigh × 2。每个项目拥有独立运行目录，方向留空时独立探索。一次批量提交最多 100 个项目，不限制总运行或排队项目数；整批意图与配置先原子保存再准备，重复提交不重复创建。准备失败可在原队列查看。暂停、全部停止和重启撤销待启动授权，已准备工作保留为排队状态。

Choose, save or set a default template beside model configuration, including when continuing a project. Templates store only engine, model, effort and new-product language, never credentials, direction or count. Existing product language remains locked. New forms use the default template, then the last submitted configuration, then the installation/launch choices saved in `.auto-loop.env` and `.auto-company.local`. Existing center preferences are preserved on upgrade. These files are parsed as data, not executed. Saving UI language alone does not change model defaults. Temporary edits do not overwrite templates; changing a template name saves a separate copy. Explicitly saving the same named selection updates that template. Clearing or deleting the default restores the last-configuration fallback.

模型配置旁支持选择、保存、设为默认，也可在继续项目时使用。模板只保存引擎、模型、思考强度和新产品语言，不保存凭据、方向或数量；已有产品语言仍锁定。默认顺序为：默认模板 → 上次提交配置 → 安装/启动流程保存在 `.auto-loop.env`、`.auto-company.local` 中的用户选择，升级保留原中心配置。仅读取这些文件，不执行其内容。只保存界面语言不会改变模型默认值。临时调整不覆盖模板；修改名称保存为另一份，显式保存同名选中项更新原模板。取消或删除默认模板后，回到上次配置。

Every submitted request retains its own configuration snapshot. Later template edits, deletion or concurrency changes cannot change queued or running requests. Missing or unsupported engines/models fail explicitly; the center does not substitute another model. Live explorations appear in the existing project list and status filters alongside formed products. Project details select the matching current request, not whichever parallel request appears first.

每次提交冻结配置；后续模板修改、删除和并发数调整不改变已排队或运行的请求。引擎或模型不可用时明确报错，不替换模型。当前探索出现在现有项目列表及状态筛选中；项目详情只匹配自身请求，不会错误显示其他并行项目的运行情况。

## Existing data and capabilities / 旧数据与能力

### Upgrading from v2.0 / 从 v2.0 升级

Back up the center data directory while its own service is stopped, keeping the original run directories and identity ledgers. Update a clean framework checkout to `v2.1.0`, then start that center with the same data directory and execution-domain settings. The release includes built Dashboard assets; users do not need Node to serve them. Developers changing the UI use `npm ci --prefix dashboard/ui`, then its `check` and `build` scripts.

在中心服务停止时备份其数据目录，保留原运行目录及身份账本；把干净的框架副本更新到 `v2.1.0`，使用原数据目录和执行域设置启动。发布版自带前端资源，用户运行服务无需Node；开发者修改界面时在 `dashboard/ui` 安装锁定依赖后执行 `check`、`build`。

Existing saved preferences and request configuration snapshots remain intact. New dispatch starts paused after restart; review reconciled ownership before resuming. Default concurrency is four; lowering it never stops existing work. Old run copies are not automatically upgraded or migrated. Incompatible sources remain readable without gaining execution permission. Do not replace an active source checkout, clear uncertain ownership, or restore only the database while discarding its matching runtime directories.

既有偏好与请求配置快照保留。中心重启后新派发暂停，先核对恢复的所有权再恢复队列。默认并发4，调低不会停止已有工作。旧运行副本不会自动升级或迁移；不兼容来源可读但不获得执行权限。不要覆盖正在运行的源码、清除不确定所有权，或只还原数据库却丢掉配套运行目录。

### Upgrading from v1.x / 从 v1.x 升级

Update a clean framework checkout using your existing Git installation workflow, then start the product center from that checkout. Existing single-runtime launch commands remain available outside center-managed directories. Register older run directories in the center to read their recorded products; registration does not update their code or grant execution permission. New exploration contexts use the center's current committed framework revision.

按原有 Git 安装方式更新干净的框架目录，再从该目录启动产品中心。未被中心接管的目录仍可使用原单运行启动方式。将旧运行目录接入中心后可以阅读其产品记录；接入不会更新旧副本代码，也不会直接授予执行权限。新探索使用中心当前已提交的框架版本创建运行上下文。

Before replacing or rolling back a managed runtime, stop its owned work and confirm cleanup, then preserve the center state, original runtime directory, local configuration and accumulated cycle records. Updating the framework does not automatically upgrade other runtime copies. Incompatible or ambiguous old contexts stay read-only until an explicit compatible takeover is possible.

替换或回退受管运行目录前，应停稳所属工作并确认清理，保留中心状态、原运行目录、本地配置和累计轮次记录。更新框架不会自动升级其他运行副本。不兼容或归属不明确的旧上下文保持只读，只有满足兼容条件后才能明确接管。

An imported archive stays read-only until a compatible, unambiguous runtime is explicitly taken over. A run directory that contains several historical products does not necessarily contain independent resumable contexts for each. Missing, conflicting or unsupported sources cannot execute. The center does not merge diverged ledgers or infer old consensus from the newest report.

旧运行根内的多个历史产品不一定各自拥有可恢复的共识与配置。兼容、归属明确的完整上下文才能被明确接管；缺失、冲突或不兼容来源只读。取消归档不增加执行权限，解除登记不删除源码。

Before starting work, the center verifies the selected product identity, registration and independent repository again. If those records no longer agree, restore the source through an explicit reviewed recovery before submitting a new request. The center preserves history and does not silently repair registration, clear protective pauses or replay the failed request. Stopping owned work and releasing control remain separate from permission to start.

开始工作前，中心再次核对所选产品的身份、登记和独立仓库。记录不一致时，需要明确核对并恢复来源，再提交新请求；中心保留历史，不自动补登记、清除保护暂停或重放失败请求。停止所属任务、解除托管与启动资格分别判断。

Source management keeps selection, takeover, release and preview actions explicit. Supported managed static websites can start or stop an owned preview and retry screenshot capture. Release first confirms that owned previews have stopped. Unsupported formats or missing dependencies remain unavailable with a reason. Capture does not create a new model request.

来源管理提供明确的选择、接管、解除接管和预览操作。受管且受支持的静态网页可以启动、停止预览或重新截图；解除接管前须确认所属预览已停止。不支持的格式或缺少依赖会说明原因，截图本身不新建模型请求。

Reported titles, summaries and phases remain model-authored records. The center parses them deterministically without a second AI summarizer. Checks, screenshots and process results are evidence with limited scope, not automatic certification that a product is complete or commercially successful. Unknown usage is not zero usage.

标题、摘要和阶段仍是模型填写的结构化记录；程序直接解析，不加第二个AI解释器。检查、实拍与进程结果各有适用范围，不等于产品已完成或商业化成功。缺失用量保持未知。

The journal initially shows the latest round and four earlier rows. Earlier history remains accessible, and retained details load when an older round is opened. Usage covers the selected product and period independently of which history rows are expanded. Verified previews open on their own loopback origin, separately from read-only document resources.

工作记录默认显示最新一轮和此前四轮，更早记录仍可展开查看；打开较早轮次时会读取其保留的详细记录。用量按所选产品和时间范围汇总，不受当前展开的轮次影响。核验后的产品预览使用独立本地地址打开，与只读文档资源分开。

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
