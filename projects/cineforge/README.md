# 镜场 CineForge

面向非专业影视人员的专业级短视频生成 Web。白话进，后台编译导演提示词，再交给本地 MiniMax-H3 或 Seedance（Ark）备用通道。

## 本地运行

```bash
cd projects/cineforge/app
npm install
npm start
```

浏览器打开 http://127.0.0.1:3200（营销落地页）；创作台在 `/studio`。

`npm start` 走开发服务器，方便改完即看。生产构建：`npm run build && npm run serve`。

## 设置

打开「设置」页切换：

| 项 | 选项 | 默认 |
| --- | --- | --- |
| 成片模型 | MiniMax-H3 / Seedance | **MiniMax-H3**（首发锁定） |
| MiniMax 基址 | 局域网 OpenAPI | `http://58.241.131.10:8088` |
| 生成模式 | ref2va / t2va / fl2va | **ref2va**（当前代理 PARTITION=`Ref2VA` 仅此任务） |
| Seedance | API 基址 + 模型名 + Key | env `SEEDANCE_API_KEY` / `ARK_API_KEY` 或设置页；**无 Key = 不可写，不 mock** |
| 提示词 LLM | local / vLLM / OpenAI | **local**（vLLM 不可达时的默认） |
| vLLM | OpenAI 兼容 | `http://58.241.131.10:30000/v1`，模型 `Qwen/Qwen3.8-27B` |

密钥只存在本机 `app/.data/store.json` 的 settings，或进程环境变量；不要提交。

### 可写判定

- MiniMax：`/health` HTTP 200 且 `status=ok`（Omni 可达）
- 或 Seedance：已配置非空 Key
- MiniMax 降级 **且** 有 Seedance Key → 自动 failover 真写（job 标记 `failover: seedance`）
- 双通道皆不可写 → 本地 `failed`，禁止 mock 冒充成片

**成片闭环：** 提交后若拿到远程任务 id，创作台每 8 秒自动 `PATCH /api/jobs` 轮询（MiniMax 与 Seedance 均支持）；成功后视频落盘到 `.data/uploads/`，页面可直接预览。

## 页面

- **`/` 落地页**：品牌开场 + 硬锁叙事 + 预约验收（waitlist）；轮询 `/api/health`，仅当 `writable === true` 时主 CTA 切到「开始生成」；探活失败默认候补文案，无假成片
- **`/studio` 创作台**：白话意图 → 锁场景/任务/空间 → 台词绑人绑声 → 编译提示词 → 提交成片
- **素材库 / 声音 / 人生克隆 / 设置**：产品壳侧栏（落地页无侧栏）

## 首成片验收

Key 或 Omni 恢复后，应用在跑时执行：

```bash
# 可选：SEEDANCE_API_KEY / ARK_API_KEY 已注入到运行 app 的进程
./projects/cineforge/scripts/accept-first-render.sh
# 或 CINEFORGE_BASE=http://127.0.0.1:3200 MAX_POLLS=60 ./projects/cineforge/scripts/accept-first-render.sh
```

退出码 0 = 真任务 succeeded 且 `.data/uploads/` 有非空 MP4。`writable=false` 时脚本直接 FAIL（不 mock）。

### 编译通道验收（无需 Key / Omni）

成片不可写时，可先验编译链路：

```bash
./projects/cineforge/scripts/accept-compile-pipeline.sh
```

退出码 0 = `compileReady=true` 且 `/api/compile` 产出含锁定项的非空 prompt。

### 编译导出包验收（无需 Key / Omni）

成片不可写时，可验「导演包」导出 schema：

```bash
./projects/cineforge/scripts/accept-compile-export.sh
```

退出码 0 = 编译 PASS + `jingchang.compile.v1` 导出包（含 draft、compiled、locksDigest）。创作台编译后可「复制提示词 / 下载导演包」。

### 导演包导入验收（无需 Key / Omni）

导出包的反向加载 — 恢复草稿与已编译提示词：

```bash
./projects/cineforge/scripts/accept-import-compile.sh
```

退出码 0 = fixture 符合 `jingchang.compile.v1` 且 draft + compiled 字段齐全。创作台 `/studio` →「导入导演包」选 JSON 文件即可还原。

### 编译轨 round-trip E2E（Playwright，无需 Key / Omni）

浏览器级 export→import 闭环自动化：

```bash
./projects/cineforge/scripts/accept-roundtrip-e2e.sh
```

退出码 0 = fixture 导入 UI 验收 + 编译→下载→重载→导入 round-trip 全 PASS。需 dev server `:3200`（脚本会复用已在跑的实例）。

单独跑 Playwright（在 `app/` 目录）：

```bash
cd projects/cineforge/app
npm install
npx playwright install chromium
npm run test:e2e
```

### 编译轨 CI gate（GitHub Actions + 本地）

一键跑齐 fixture → pipeline → export → Playwright E2E（无需 Key / Omni）：

```bash
./projects/cineforge/scripts/accept-ci-gate.sh
```

GitHub Actions workflow：`.github/workflows/cineforge-compile-gate.yml`  
触发：`projects/cineforge/**` 变更的 PR / main push，或 `workflow_dispatch`。

仓库根目录快捷命令：

```bash
make cineforge-ci-gate    # 编译轨全门禁
make cineforge-health     # 运行态摘要
make cineforge-waitlist   # waitlist 冒烟 + 统计
make cineforge-push-ready # 入库前验收（密钥扫描 + 全门禁 + 人类 commit 指令）
```

### 入库前验收（人类 commit/push 前）

一键跑齐密钥扫描、敏感路径检查、编译轨 CI gate、health、waitlist：

```bash
make cineforge-push-ready
# 或 SKIP_CI=1 make cineforge-push-ready  # 仅清单 + 密钥扫描
```

退出码 0 = 可安全入库；脚本末尾输出建议 `git add` / `commit` / `push` 命令。

### GitHub handoff Issue（可追踪入库清单）

收敛规则：空等 commit/push 时，改开 GitHub Issue 追踪进度：

```bash
make cineforge-handoff
# 或 REQUIRE_PASS=0 ./projects/cineforge/scripts/create-handoff-issue.sh  # 跳过 push-ready 复验
```

- 标签 `cineforge-handoff`；已有 open issue 时追加评论而非重复开单
- Issue 含待入库路径、health/waitlist 快照、建议 commit 命令

### 运行态探活

```bash
./projects/cineforge/scripts/status-health.sh
```

输出 `compileReady` / `writable` / MiniMax / Seedance / LLM 摘要；`STATUS=compile-only` 表示编译轨可用、成片仍 blocked。

### waitlist 运营

```bash
./projects/cineforge/scripts/accept-waitlist.sh   # API 验收
./projects/cineforge/scripts/waitlist-stats.sh    # 本地名单摘要
./projects/cineforge/scripts/waitlist-stats.sh --csv > waitlist.csv
```

数据在 `app/.data/waitlist.json`（gitignore），不上传。

### 成片轨可选 CI（需 secret）

`.github/workflows/cineforge-render-gate.yml` — 仅 `workflow_dispatch`；repository 配置 `SEEDANCE_API_KEY` 后手动触发，跑 `accept-first-render.sh` 并上传 MP4 artifact。无 secret 时 job 跳过，不阻塞编译轨。

### Key 一键注入

```bash
SEEDANCE_API_KEY=你的Key ./projects/cineforge/scripts/inject-seedance-key.sh
# 或 ./projects/cineforge/scripts/inject-seedance-key.sh <KEY>
```

写入本机 `app/.data/store.json` settings，不提交仓库。成功后跑 `accept-first-render.sh`。

对外中文名：**镜场**（已锁定）。
