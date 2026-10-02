# 引擎适配器

[中文](ENGINE_ADAPTERS.md) | [English](../../ENGINE_ADAPTERS.md) · [文档与语言设置](../README.md)

以下命令均在仓库根目录运行。

`scripts/core/auto-loop.sh` 负责调度和循环策略；`scripts/core/engine-adapters.sh` 负责引擎发现、调用形式与敏感信息脱敏；`engine-metadata.py` 使用 Python 标准库统一提供方的 JSON 和 JSONL 格式。`scripts/core/process-supervisor.sh` 负责每轮 Cycle 的进程组（PGID）、超时、子孙进程清理及清理结果校验；无法确认清理成功时会阻止继续运行，所有适配器都使用这套机制。

Claude 仍是默认引擎。Cursor 和 OpenAI-compatible 支持必须显式启用，已有安装升级后不会因此改变行为。

## 选择与安全

**所有执行现在必须经过项目隔离。** 模型循环、交互团队、产品检查和截图子进程使用 Linux/WSL2 的同一内核隔离边界。缺少 bubblewrap、libseccomp 或内核能力时拒绝启动；原生 Windows/macOS 和尚未验证的 Cursor 打包暂不执行，不回退到宿主裸跑。详见[安装、可见输入、网络策略与恢复](../../docs/project-isolation.md)。下表的引擎权限是在此边界内的附加策略。即使适配器允许 HTTP，宿主本地或私有网络端点也不可访问。

| 引擎 | 必要的启用设置与配置 | 默认安全行为 |
| --- | --- | --- |
| `claude` | 无 | 启动前校验显式设置的权限模式。首次试运行时，文档建议用较安全的 `default` 覆盖默认设置。 |
| `codex` | `ENGINE=codex` | 在强制内核隔离内保留所选沙箱策略；不导入全局插件、MCP 配置或会话历史。 |
| `cursor` | `ENGINE=cursor`、`CURSOR_ADAPTER_ENABLED=1` | 当前拒绝执行：隔离打包与认证尚未验证，不回退到宿主运行。 |
| `openai-compatible` | `ENGINE=openai-compatible`、`OPENAI_COMPATIBLE_ADAPTER_ENABLED=1`、完整的 `OPENAI_COMPATIBLE_ENDPOINT`，以及 `OPENAI_COMPATIBLE_MODEL`（或 `MODEL`） | 接受 HTTPS 和环回地址的 HTTP。非环回 HTTP 默认被拒绝，除非设置 `OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1`。内置文件工具先解析路径，再访问项目目录内的文件，并拒绝 Git 元数据及已知凭据路径。命令按完整 argv 精确白名单执行，不经过 shell。仅在设置 `OPENAI_COMPATIBLE_ALLOW_SHELL=1` 后才提供任意 Bash 执行能力。 |

适配器接受的 Claude 权限模式与当前 CLI 契约一致：`acceptEdits`、`auto`、`bypassPermissions`、`default`、`dontAsk` 和 `plan`。空值表示由 CLI 自行选择。其他任何显式值都会在循环或守护进程启动前被适配器校验拒绝。

端点、模型和 API 密钥均无内置值。`OPENAI_COMPATIBLE_API_KEY` 仅从进程环境读取；存在时作为 Bearer 令牌发送。不得把 API 密钥放入 `.auto-loop.env`、launchd plist、命令参数或仓库文件。

OpenAI-compatible 传输策略会在适配器校验时检查，并在 Python 请求边界再次检查，包括直接调用的情况。HTTPS 端点允许使用。明文 HTTP 默认仅允许环回主机（`localhost`、`127.0.0.0/8` 和 `[::1]`），除非显式设置 `OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1`。环回请求会绕过继承的代理设置，防止通过代理离开本机。允许非环回 HTTP 的例外默认关闭；启用后，提示词、工具结果和 Bearer 密钥都会以明文传输，因此仅应对隔离网络中由操作者信任的端点使用。请求实现仍禁止重定向。

在 WSL/Linux 上，适配器校验失败会以配置错误状态码 `78` 退出；生成的 systemd 用户服务将该状态视为不可重启，避免无效配置引发反复重启。

示例（所有值均由操作者提供）：

```bash
ENGINE=cursor \
CURSOR_ADAPTER_ENABLED=1 \
CURSOR_BIN=/path/to/cursor-agent \
make start

ENGINE=openai-compatible \
OPENAI_COMPATIBLE_ADAPTER_ENABLED=1 \
OPENAI_COMPATIBLE_ENDPOINT="$YOUR_CHAT_COMPLETIONS_ENDPOINT" \
OPENAI_COMPATIBLE_MODEL="$YOUR_MODEL" \
make start

# 仅限操作者信任的隔离网络中的例外情况：
ENGINE=openai-compatible \
OPENAI_COMPATIBLE_ADAPTER_ENABLED=1 \
OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1 \
OPENAI_COMPATIBLE_ENDPOINT="$YOUR_TRUSTED_HTTP_ENDPOINT" \
OPENAI_COMPATIBLE_MODEL="$YOUR_MODEL" \
make start
```

OpenAI-compatible 的安全命令默认是精确匹配的只读 argv 序列，涵盖简短 Git 状态、差异统计、近期提交记录、仓库根目录查询和 `rg --files`。只有审查每条完整命令后，才可覆盖以逗号分隔的 `OPENAI_COMPATIBLE_SAFE_COMMANDS`。不接受额外的尾随参数。

安全命令不得解析到可写工作区内的可执行文件。Git 调用会禁用文件系统监控钩子、分页器和签名显示，并移除继承的 Git 配置覆盖项；Ripgrep 会忽略继承的配置。这些限制防止仓库配置或模型写入的可执行文件将内置只读命令变成任意执行入口；操作者添加的命令仍需审查。

### 内置文件工具边界

OpenAI-compatible 适配器对内置 `read_file` 和 `write_file` 工具应用相同的路径检查。访问前会先解析路径，因此会拒绝 `..` 路径穿越、项目外路径、指向项目外目标的符号链接，以及指向受保护目标的符号链接别名。匹配不区分大小写，覆盖以下范围：

- 名为 `.git` 的 Git 元数据目录；
- 实际使用的 dotenv 文件（标准 `.example`、`.sample`、`.template` 变体仍可读取）；
- 包管理与版本控制认证文件，如 `.npmrc`、`.pypirc`、`.netrc` 和 `.git-credentials`；
- 私钥与证书包扩展名 `.key`、`.pem`、`.p12` 和 `.pfx`；
- SSH、AWS、Azure、Google Cloud、Kubernetes、Docker、GitHub CLI、GitLab CLI 和 Terraform 的常见凭据位置。

文件工具拒绝访问时，错误信息不包含请求路径或文件内容。这是一种基于路径的保守防护，不是基于内容的秘密检测，也不是操作系统沙箱。它无法根据内容识别已重命名或通过硬链接访问的凭据；操作者新增的命令也可能暴露文件。启用 `OPENAI_COMPATIBLE_ALLOW_SHELL=1` 会向模型提供任意 Bash 工具，该工具不受上述文件路径策略约束。仍应使用无密钥的可丢弃克隆，并审查每条自定义安全命令。

## 每轮 Cycle 的契约

每个 `logs/cycle-<id>.log` 都有一个同目录记录文件 `logs/cycle-<id>.json`：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schema_version` | 整数 | 契约版本，当前为 `1`。 |
| `engine` | 字符串 | 所选适配器名称。 |
| `status` | 字符串 | 适配器执行状态：`success`、`error` 或 `timeout`。 |
| `cycle_outcome` | 字符串 | 循环判定：`success`、`failure` 或 `soft_timeout`。 |
| `failure_reason` | 字符串 | 循环层拒绝原因；接受结果时为空。 |
| `result` | 字符串 | 脱敏后的提供方结果，最多 2,000 字节。 |
| `cost_usd` | 数值或 null | 提供方报告的费用，适配器不会估算。 |
| `input_tokens` | 整数或 null | 提供方报告的输入／提示词 token 数。 |
| `output_tokens` | 整数或 null | 提供方报告的输出／生成 token 数。 |
| `total_tokens` | 整数或 null | 提供方报告的总量；若未报告且输入、输出都已知，则为两者之和。 |
| `subtype` | 字符串 | 提供方子类型；缺失时使用统一的回退值。 |
| `type` | 字符串 | 提供方事件类型；缺失时按引擎回退。 |
| `exit_code` | 整数 | 进程退出码；监管器超时为 `124`。 |
| `timed_out` | 布尔值 | 该轮是否由公共 PGID 监管器判定超时。 |

未知数值写为 JSON `null`，不会使用 `"N/A"` 等字符串。这个伴随文件是结构化用量、预算和 `/api/usage` 唯一的引擎元数据输入；这些使用方不解析提供方输出。原始 Cycle 日志在写入前也会脱敏。

Codex 使用 `exec --json`，读取 `turn.completed.usage` 对象；供人阅读的 `tokens used` 文本不作为记账来源。输入和输出 token 分别记录，缓存输入不重复计数，缺失的美元费用保持未知。这与 [Codex 官方 JSONL 契约](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable) 一致。Claude 会将已报告的缓存读取和缓存创建输入计入输入总量。一个 Cycle 内有多个 OpenAI-compatible 请求时，只有每个请求都提供某项指标，才会累计该指标；任何请求缺失该指标，结果都保持未知。达到本地工具交互轮数上限时，保留此前已报告的用量；HTTP 请求失败则会使受影响的 Cycle 总量变为未知。

即使进程以零退出，提供方的 `is_error`、错误子类型和 Codex `turn.failed` 事件仍会使该轮失败。非零进程退出码和监管器超时优先于提供方的成功结果。结构化元数据缺失或格式错误会被视为适配器错误。循环仍会单独应用既有的、基于共识的软超时策略。

## 不调用真实提供方的验证

契约测试使用假的 CLI 可执行文件和本地假 HTTP 服务，不会调用 Claude、Codex、Cursor 或外部模型：

```bash
python3 -m unittest -v tests.test_engine_adapters
```

测试覆盖 Claude/Codex 参数、Cursor 沙箱策略、用量统一、工作区边界、安全命令与 shell 策略、HTTP 重定向及错误、PGID 监管超时、API 密钥脱敏，以及假提供方参与下的实际循环结果。`tests/test_process_supervisor.sh` 另行验证子孙进程清理、孤儿进程清理、信号处理和无关进程隔离。
