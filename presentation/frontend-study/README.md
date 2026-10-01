# Frontend prompt comparison / 前端提示词对照

2026-10-02 · `frontend-task-first-v1`

**The new prompt bundle won two of three fixed-product comparisons; the third was a tie.** All 12 common browser scenarios passed (three products × two versions × desktop/mobile). The primary agent reviewed the actual input, working and result screens and retained B for future frontend work. The manually refined public examples are a separate deliverable, not the outputs used to decide this comparison.

**新版在三个固定产品中两胜一平。** 三个产品、两版提示词、桌面与手机组成的 12 次共同浏览器验收全部通过。父代理查看真实输入、工作中及结果页面后，选择保留 B。公开案例的人工精修与本次实验独立，不能拿人工精修后的效果充当提示词胜出的证据。

## What changed / 改了什么

A used the frontend instructions from base commit `8becd542a3c76d286b21b27e15b99d71a4f2d0ca`. B changed the frontend skill, UI role, and their handoff in the main/team prompts. It asks the team to start with the actual user task and content priority, specify component states and typography, preserve an existing product's identity, and verify real screens. Redundant explanations move out of the main task; relevant errors, privacy and limits remain readable. It prescribes no shared palette or framework.

A 为上述基线的原规则；B 修改前端技能、UI 角色及主提示与团队交接。B 先确定任务、内容优先级、字体与组件状态，再核对实现；精修保留原产品身份，不指定统一配色、模板或框架。删减重复介绍和装饰性小字，必要错误、隐私和限制仍在相关决策处清楚呈现。

Historical file comparisons found **no change to the frontend skill/UI chain across the three earlier commercial-prompt variants**; the earlier ScopeFence also used that chain. This does not support attributing the repeated green appearance to those commercial edits. Conflicting design instructions and weak design-to-implementation handoffs were plausible mechanisms to test, not proven historical causes.

历史文件对照显示，之前三版商业提示调整期间前端技能与 UI 链路没有改变；早期 ScopeFence 也使用同一套前端规则。因此没有证据把相似绿色风格直接归因于商业提示改动。旧规则中“独特设计”与套用常见设计系统、创新须有 10 倍收益的要求相冲突，设计与实现的交接也不够具体；这些是此次检验的机制，不是已证明的历史因果。

The adapted skill includes the original [Anthropic frontend-design source](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md), attribution and [Apache-2.0 license](../../.claude/skills/frontend-design.LICENSE.txt), with additional reference to [OpenAI frontend guidance](https://developers.openai.com/api/docs/guides/frontend-prompt). The retained [local skill](../../.claude/skills/frontend-design.md) is an explicit project adaptation.

## Controls and acceptance / 控制变量与验收

- Three sealed existing products, one fresh independent run per version and product; the same task, starting source, fixtures, tooling and permissions within each pair. Only the frontend instruction bundle differed. Up to three runs executed concurrently, without an arbitrary cycle cutoff.
- All six actual session settings were checked: `gpt-6.1-sol`, reasoning effort `high`. All six completed normally. No model substitution was used.
- A common acceptance runner, prepared by the implementation agent and reviewed by the primary agent, used fresh browser contexts, identical inputs/actions, 1440×1000 and 390×844 viewports, actual downloads and source-integrity checks. All six product trees remained unchanged during this acceptance. The primary agent made the final visual judgment.
- The adoption rule was set before results: no new core regression in any pair, B wins at least two pairs, and each win has concrete task/component benefits. Four dimensions use 0–4: blocked, poor, usable but rough, mature/clear, exceptional. Scores are reviewer judgments, not conversion or revenue metrics.

三对使用封存的相同起点、相同任务与夹具，每版每项目各一次独立运行；模型及强度均核实为 `gpt-6.1-sol/high`。统一验收脚本由实施代理准备、父代理审阅，实际操作和下载保持对称，父代理负责最终视觉判断。预先约定：没有新增核心功能回退，且 B 至少两对胜出，并有具体任务或组件改善，才采用 B。

## Primary-agent review / 父代理评分

Each cell lists **task hierarchy / product identity / component finish / text and information**, followed by the total (maximum 16).

评分顺序为 **任务层级 / 产品辨识度 / 组件完成度 / 文字与信息**；每项 0–4，总分 16。

| Fixed product / 固定项目 | A | B | Judgment / 判断 |
| --- | --- | --- | --- |
| Dual Flavor Table / 一桌双味 | 3 / 3 / 2 / 2 = **10** | 3 / 3 / 3 / 3 = **12** | B: larger readable controls and clearer A/B portions; the mobile result retains explicit 3/5 and 2/5 allocation. B 的控件和正文更易读，两组分量直接对应，手机端仍明确显示分配。 |
| Chart Proof / 图证工作台 | 3 / 2 / 2 / 2 = **9** | 3 / 2 / 3 / 3 = **11** | B: clearer labels, review state and primary actions; denser but readable mobile records; persistent feedback no longer overlays the work area. B 的标签、复核状态和主操作更清楚；手机记录更紧凑，反馈不再遮住工作区。 |
| Family Art Show / 家里的小展会 | 3 / 3 / 3 / 3 = **12** | 3 / 3 / 3 / 3 = **12** | Tie: B makes pause status and ordered works clearer; A keeps mobile hosting controls close at hand. Both preserve the gallery character and consent. 平局：B 的暂停提示、作品顺序更清楚；A 的手机主持操作更容易随时使用。 |

### Same-state screenshots / 同状态实拍

The PNGs are unchanged browser captures of synthetic inputs. Product state is the same within each pair; timestamps and generated IDs naturally differ. Open images at full size. [Hashes and frozen prompt files](manifest.json).

图片直接来自浏览器，使用合成输入，未编辑像素。每对产品状态一致，实际时间戳与新建 ID 自然不同。点击可查看原尺寸；[哈希与冻结提示清单](manifest.json)。

| Product | A: original prompt | B: retained prompt |
| --- | --- | --- |
| Meal result / 餐单结果 | [![A meal result](everyday-A-desktop.png)](everyday-A-desktop.png) · [Mobile / 手机](everyday-A-mobile.png) | [![B meal result](everyday-B-desktop.png)](everyday-B-desktop.png) · [Mobile / 手机](everyday-B-mobile.png) |
| Reviewed data / 已复核数据 | [![A reviewed data](professional-A-desktop.png)](professional-A-desktop.png) · [Mobile / 手机](professional-A-mobile.png) | [![B reviewed data](professional-B-desktop.png)](professional-B-desktop.png) · [Mobile / 手机](professional-B-mobile.png) |
| Paused hosting / 暂停主持 | [![A paused hosting](experience-A-desktop.png)](experience-A-desktop.png) · [Mobile / 手机](experience-A-mobile.png) | [![B paused hosting](experience-B-desktop.png)](experience-B-desktop.png) · [Mobile / 手机](experience-B-mobile.png) |

## Functional evidence and limits / 功能证据与边界

The shared checks exercised meal quantities and cooking batches, saved progress, constraint failure, exports/restores and invalid backups; chart data semantics, source-change review invalidation, draft/filter handling and standalone HTML; artwork ordering, images, pause/continue, saved narration, privacy withdrawal, printing and backup recovery. All 12 scenarios passed without page/console errors or horizontal overflow.

共同检查覆盖餐单数量与分锅、进度保存、无解约束、真实导出/恢复与坏备份；图表数据语义、修改来源后的复核失效、草稿与筛选、独立 HTML；作品顺序、图片、暂停/继续、原话保存、撤下后的隐私、打印与备份恢复。12 次全部通过，无页面或控制台错误、无横向溢出。

The unchanged original checks also passed for each version: meal planner 12 unit + 10 browser checks, chart workbench 15 unit + 10 browser checks, and art show 16 browser checks. The first art-show check run had one local-file path failure per version after copying the test runner; both original failures were retained, and only those two checks were rerun after correcting the acceptance runner's path. Product source and assertions were unchanged. Four additional symmetric long-label checks passed. Image, long-narration and long-label supplements were added for acceptance after generation; they are not represented as pre-frozen inputs.

每版原有检查也全部覆盖通过：餐单 12 项单元与 10 项浏览器检查，图表 15 项单元与 10 项浏览器检查，小展会 16 项浏览器检查。小展会首次各有一项因验收脚本副本的本地路径错误失败；保留失败证据，仅修正验收路径后定向重跑，两项通过，产品源码和断言未变。额外四项对称长标签检查通过。图片、长原话与长标签的验收补充是在生成结束后加入，不冒充事先封存的输入。

This is a **small, non-blinded refinement study**: three products, one generation per arm, no statistical replication and no human customer study. The reviewer had already seen some generated screenshots and knew the versions. It supports a local prompt choice, not universal superiority, new-product originality or increased willingness to pay. Existing product palettes were intentionally preserved, so this is not a test of palette diversity in newly generated products.

这是**小样本、非盲评的精修实验**：三个产品、每臂一次，没有统计重复，也没有真人客户研究。父评审此前已看过部分生成截图且知道版本。它支持本项目选择新的前端提示词，不能证明普遍更优、新产品更原创或付费意愿提升。任务要求保留已有身份，因此也不构成新项目配色多样性的验证。

Two task-packaging ambiguities applied equally: `CASE.md` was referenced but its contents were embedded in the task rather than provided as that file; the art-show fixture requested a missing-title error although the original product deliberately permits unnamed works. Neither was scored against one arm, and the fixture was not rewritten after seeing results. Raw model sessions, private paths and original run copies remain outside the public repository.

两处任务包装歧义对称存在：任务提及 `CASE.md`，但实际以任务正文内嵌提供；小展会夹具要求空标题报错，而原产品允许不命名。两项均未单独处罚某一版本，也没有事后改写夹具。原模型会话、私密路径和原运行副本不公开。
