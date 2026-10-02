# 运行模型读取边界审计摘要

2026-10-02。依据保存的真实运行日志、匹配会话工具调用和准备脚本进行只读检查；原始记录未修改。此公开摘要不包含本机路径、日志正文或未公开项目内容。

**检查确认：不同运行使用独立目录，不代表模型只能读取该目录。** 已观察到以下三类情况，不能混为一谈：

| 证据类别 | 已确认案例 | 结论范围 |
|---|---|---|
| 读取其他运行的既有产品内容 | 2026-09-18 的一个历史模型运行成功读取另一运行中既有产品的说明、浏览器测试源码及配置，并借用测试依赖 | 确实发生过跨运行的内容读取；不能仅描述为依赖加载，也不能由此断言复制了业务实现 |
| 读取父级实验材料 | 2026-10-02 上轮前端 A/B 的 experience-A/B 读取父级任务与输入清单；A 还读取实验协议和冻结检查，B 还读取模型设置 | 上轮严格读取隔离不成立。协议在任何一臂完成前被读取，内容为前置方案与评审规则；没有发现读取另一臂已完成答卷或其他产品源码的直接证据 |
| 枚举路径、依赖使用与明确提供的上下文 | 若干运行搜索父目录文件名、发现运行根内继承的历史项目，或加载共享测试依赖。另一个接续运行读取了父返修明确允许的合成测试输入 | 文件名、依赖加载和授权输入不等于读取其他项目答案。部分实验准备本身带入历史示例，因此也不能称这些输入完全没有历史产物 |

检查关联了59个运行根的372个模型会话，涵盖商业立项、14项产品接续、上轮六组前端 A/B、八套历史运行和三套产品中心运行。商业立项和接续部分未找到成功展开无关兄弟项目源码或答案的直接确证；这不是“保证从未读取”的证明。

当次 `workspace-write` 配置限制的是可编辑位置，不能当作只允许读取工作区的保证；实际返回父级材料也证实了这一点。本次没有操作系统层的完整文件打开记录，工具日志还可能截断或省略间接读取，因此不能宣称完整排除所有越界或历史影响。

上轮前端 A/B 的**严格隔离及强因果表述撤回**：这些结果不能单独证明观察到的差异只由提示变化造成。真实功能检查、失败记录和真实截图仍保留，可作为实际运行案例；它们不自动成为严格独立实验的证明。

后续新运行的输入准备已改善为只带当前产品和必要任务材料，补齐明确的任务文件引用。这减少了不相关上下文，但**不等同于已经建立操作系统读取沙箱**。如需硬性隔离，应使用只挂载必要文件的独立执行环境，并以无敏感内容的测试文件验证父级与兄弟目录确实不可读。

本轮仅排查，没有修改生产权限、重启历史任务或重新执行旧实验。

后续 C 批次另行核对了三份最终会话（95 次工具调用、102 条完成命令），未发现读取父评审资料或其他产品内容。实际外部访问涉及浏览器运行时、任务配置的依赖、临时目录元数据和系统字体。三组输入已仅保留当前产品并完整提供 CASE；由于没有操作系统文件打开审计，这不能证明硬读取隔离，也不能恢复旧 A/B 的强因果结论。此补充不混入上述 59 个运行根的统计。

## English summary

The audit linked 372 model sessions to 59 run roots. It confirmed that a September 18 historical run read another run's product documentation, browser-test source and configuration. This establishes cross-run content access, not copying of its business implementation.

The previous frontend A/B Family Art Show runs also read parent-level experiment materials. A read the planned protocol before any arm completed; the observed records did not establish a read of another arm's completed frontend. Some other calls merely listed filenames, loaded shared dependencies or read a synthetic input explicitly provided for repair. These are separate categories.

The recent commercial-opportunity and continuation records did not provide direct confirmation of reads of unrelated sibling product source or answers. That absence is not proof that no such read occurred. Inputs also included inherited historical examples.

The strict read-isolation and single-variable causal characterization of the old A/B study is withdrawn. Its actual screenshots and functional results remain valid observations. Separate folders and the observed `workspace-write` configuration were not a read boundary.

New experiment inputs contain only the current product and required task materials, including the previously missing CASE file. This reduces irrelevant context but does not establish an operating-system sandbox. A hard boundary requires an execution environment that exposes only needed files and synthetic tests proving that parent and sibling files cannot be read. No production permissions or historical runs were changed.

This is a tool-log audit, not a complete operating-system file-access trace. Truncated output and indirect reads limit negative conclusions.

A separate check of the three completed C sessions covered 95 tool calls and 102 completed commands. It found no recorded reads of parent evaluation materials or other product content. Observed external access involved browser runtimes, configured task dependencies, temporary-directory metadata and system fonts. This narrower input preparation does not prove a hard read boundary or restore the old A/B study's strong causal interpretation. These three sessions are separate from the 59-root totals above.
