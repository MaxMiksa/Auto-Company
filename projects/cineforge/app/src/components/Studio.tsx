"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { json } from "@/lib/api";
import {
  buildCompileExport,
  downloadCompileExport,
} from "@/lib/export-compile";
import { readCompileExportFile } from "@/lib/import-compile";
import {
  emptyDraft,
  type Asset,
  type CompiledPrompt,
  type Job,
  type ProjectDraft,
  type Settings,
  type VoiceProfile,
} from "@/lib/types";

type HealthInfo = {
  writable?: boolean;
  compileReady?: boolean;
  llm?: { ok?: boolean; detail?: string };
  minimax?: {
    ok?: boolean;
    detail?: string;
    status?: string;
    proxyUp?: boolean;
    omniOk?: boolean;
    meta?: { partition?: string; tasks_enabled?: string[] };
  };
  seedance?: {
    ready?: boolean;
    ok?: boolean;
    model?: string;
    detail?: string;
  };
  defaults?: { generateMode?: string; reason?: string };
};

/** 把远端 JSON 错误压成可读一行。 */
function humanizeJobError(raw?: string): string {
  if (!raw) return "";
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string; code?: string; details?: { body?: string } };
    };
    const msg = j.error?.message || "";
    const code = j.error?.code || "";
    let nested = "";
    if (j.error?.details?.body) {
      try {
        const inner = JSON.parse(j.error.details.body) as { error?: { message?: string } };
        nested = inner.error?.message || j.error.details.body.slice(0, 120);
      } catch {
        nested = j.error.details.body.slice(0, 120);
      }
    }
    return [code, msg, nested].filter(Boolean).join(" · ").slice(0, 280);
  } catch {
    return raw.slice(0, 280);
  }
}

function applyScene(draft: ProjectDraft, scene: Asset): ProjectDraft {
  return {
    ...draft,
    scene: {
      ...draft.scene,
      sceneId: scene.id,
      name: scene.name,
      space: draft.scene.space || scene.description,
      light: draft.scene.light || "暖黄灯箱为主光，窗外霓虹作辅光，柜台有一小盏阅读灯",
      props: draft.scene.props || "风铃、冷柜、缺口搪瓷杯",
      immutable: draft.scene.immutable || scene.doNotTransfer,
    },
  };
}

export function Studio() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft());
  const [compiled, setCompiled] = useState<CompiledPrompt | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      json<Asset[]>("/api/assets"),
      json<VoiceProfile[]>("/api/voices"),
      json<Settings>("/api/settings"),
      json<Job[]>("/api/jobs"),
      json<HealthInfo>("/api/health").catch(() => null),
    ]).then(([a, v, s, j, h]) => {
      setAssets(a);
      setVoices(v);
      setSettings(s);
      setJobs(j);
      if (h) setHealth(h);
      const scene = a.find((x) => x.kind === "scene");
      const chars = a.filter((x) => x.kind === "character");
      const objects = a.filter((x) => x.kind === "object");
      let next = emptyDraft();
      next.intent = "夜班快结束时，林晚把缺口杯推给周叔，只说一句「还开着就好」。不要煽情，不要换场。";
      next.task.goal = "完成一次克制的交杯与一句对白，确认店还开着。";
      next.task.success = "看见杯子换手、听见林晚的那句台词、周叔点头。";
      if (scene) next = applyScene(next, scene);
      next.objectIds = objects.map((o) => o.id);
      next.blocking = chars.map((c, i) => ({
        characterId: c.id,
        stance: i === 0 ? "收银台外侧，靠近玻璃门" : "柜台内侧，双手撑台沿",
        bodyFacing: i === 0 ? "朝向柜台" : "朝向门口来人",
        eyeline: i === 0 ? "周叔眼睛" : "林晚眉疤再落到杯子",
        inOut: "已在画内",
        depth: i === 0 ? "中" : "中",
        camera: "过肩中景，从门向柜台缓慢推近",
        lensFeel: "35mm，保留货架进深",
      }));
      const vLin = v.find((x) => x.id === "voice-lin");
      const vZhou = v.find((x) => x.id === "voice-zhou");
      next.lines = [
        {
          id: "l1",
          characterId: chars[0]?.id || "",
          voiceId: vLin?.id || v[0]?.id || "",
          text: "还开着就好。",
          emotion: "压着的松一口气",
          atSec: 5,
        },
        {
          id: "l2",
          characterId: chars[1]?.id || "",
          voiceId: vZhou?.id || v[1]?.id || "",
          text: "今晚不关。",
          emotion: "低、慢、落下",
          atSec: 7,
        },
      ].filter((l) => l.characterId);
      setDraft(next);
    });
  }, []);

  const pendingRemote = jobs.some(
    (j) => !j.mocked && (j.status === "queued" || j.status === "running") && j.remoteJobId,
  );

  useEffect(() => {
    if (!pendingRemote) return;
    let alive = true;
    const tick = async () => {
      try {
        const out = await json<{ jobs: Job[] }>("/api/jobs", { method: "PATCH" });
        if (alive) setJobs(out.jobs);
      } catch {
        /* 下一轮再试 */
      }
    };
    tick();
    const id = window.setInterval(tick, 8000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pendingRemote]);

  const scenes = assets.filter((a) => a.kind === "scene");
  const chars = assets.filter((a) => a.kind === "character");
  const objects = assets.filter((a) => a.kind === "object");
  const sceneAsset = assets.find((a) => a.id === draft.scene.sceneId);
  const tasksEnabled = health?.minimax?.meta?.tasks_enabled ?? [];
  const partition = health?.minimax?.meta?.partition;
  const minimaxDown = health?.minimax ? health.minimax.ok === false : false;
  const seedanceReady = Boolean(health?.seedance?.ready);
  const compileReady = health?.compileReady === true || health?.llm?.ok === true;
  const canSubmit = health?.writable === true || (!minimaxDown && health?.writable !== false);
  const engineDown = !canSubmit;
  const failedJobs = jobs.filter((j) => j.status === "failed");

  const lockOk = useMemo(
    () => Boolean(draft.scene.sceneId && draft.task.goal && draft.blocking.length),
    [draft],
  );

  async function compile() {
    setBusy("compile");
    setError("");
    try {
      const out = await json<CompiledPrompt>("/api/compile", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setCompiled(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "编译失败");
    } finally {
      setBusy("");
    }
  }

  async function copyPrompt() {
    if (!compiled?.prompt) return;
    try {
      await navigator.clipboard.writeText(compiled.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选中提示词");
    }
  }

  function saveExport() {
    if (!compiled) return;
    downloadCompileExport(buildCompileExport(draft, compiled));
  }

  async function importBundle(file: File) {
    setError("");
    setImportNote("");
    const result = await readCompileExportFile(file);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(result.draft);
    setCompiled(result.compiled);
    const exportedAt = result.bundle.exportedAt
      ? new Date(result.bundle.exportedAt).toLocaleString("zh-CN")
      : "未知时间";
    setImportNote(
      `已导入导演包（${exportedAt}）· 编译轨交付，非成片 · digest ${result.compiled.locksDigest.slice(0, 12)}…`,
    );
  }

  function triggerImport() {
    importRef.current?.click();
  }

  async function submit() {
    setBusy("job");
    setError("");
    try {
      const job = await json<Job>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ draft, prompt: compiled?.prompt }),
      });
      setJobs((prev) => [job, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy("");
    }
  }

  function setSceneId(id: string) {
    const scene = assets.find((a) => a.id === id);
    if (scene) setDraft(applyScene(draft, scene));
  }

  function toggleChar(id: string) {
    const exists = draft.blocking.some((b) => b.characterId === id);
    if (exists) {
      setDraft({
        ...draft,
        blocking: draft.blocking.filter((b) => b.characterId !== id),
        lines: draft.lines.filter((l) => l.characterId !== id),
      });
      return;
    }
    setDraft({
      ...draft,
      blocking: [
        ...draft.blocking,
        {
          characterId: id,
          stance: "",
          bodyFacing: "",
          eyeline: "",
          inOut: "已在画内",
          depth: "中",
          camera: "",
          lensFeel: "",
        },
      ],
    });
  }

  function patchBlock(i: number, patch: Partial<ProjectDraft["blocking"][0]>) {
    const blocking = draft.blocking.slice();
    blocking[i] = { ...blocking[i], ...patch };
    setDraft({ ...draft, blocking });
  }

  function patchLine(i: number, patch: Partial<ProjectDraft["lines"][0]>) {
    const lines = draft.lines.slice();
    lines[i] = { ...lines[i], ...patch };
    setDraft({ ...draft, lines });
  }

  return (
    <div>
      <h1>创作台</h1>
      <p className="lead">
        写你想看到的一段。系统会锁住这场戏、这个任务、这些人站哪、这句话谁说。
        专业提示词在后台生成，你不用自己写。
      </p>
      {minimaxDown && seedanceReady && (
        <div className="banner warn" role="status">
          <strong>主通道降级 · 备用 Seedance 可写</strong>
          <span>
            MiniMax Omni/Stage-0 不可用（{health?.minimax?.status || "degraded"}
            {health?.minimax?.omniOk === false ? " · omni error" : ""}
            ）。已配置 Seedance Key，提交将自动 failover 到备用真写（非 mock）。
          </span>
          <span className="banner-meta">
            模型 {health?.seedance?.model || "seedance"} · 验收标「备用通道成片」，与局域网 Ref2VA 非同质
          </span>
        </div>
      )}
      {engineDown && compileReady && (
        <div className="banner warn" role="status">
          <strong>编译通道可用 · 成片待 Key</strong>
          <span>
            导演提示词可正常生成（{health?.llm?.detail || "local 规则编译"}）。
            成片提交仍被禁，直到 Omni 恢复或注入 Seedance Key。
          </span>
          <span className="banner-meta">
            可先「下载导演包」离线保存提示词 · 验收：accept-compile-export.sh · Key：inject-seedance-key.sh
          </span>
        </div>
      )}
      {engineDown && (
        <div className="banner danger" role="alert">
          <strong>成片通道不可用</strong>
          <span>
            MiniMax Omni/Stage-0 降级
            {health?.minimax?.status ? `（${health.minimax.status}）` : ""}
            ，且未配置 Seedance Key。提交会被本地拒绝。
          </span>
          <span className="banner-meta">
            恢复：Omni /health 连续两次 status=ok，或设置 SEEDANCE_API_KEY / ARK_API_KEY
          </span>
        </div>
      )}
      {failedJobs.length > 0 && (
        <div className="banner warn" role="status">
          <strong>最近失败尸检</strong>
          {failedJobs.slice(0, 2).map((j) => (
            <div key={j.id} className="banner-meta">
              {j.id}
              {j.remoteJobId ? ` · remote ${j.remoteJobId}` : ""} · {j.createdAt}
              <br />
              {humanizeJobError(j.error) || "无错误正文"}
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ marginBottom: 16 }}>
        <span className="badge lock">成片 {settings?.videoProvider}</span>
        <span className="badge lock">编译 {settings?.llmProvider}</span>
        <span className={lockOk ? "badge ok" : "badge warn"}>
          {lockOk ? "场景 / 任务 / 空间 已锁定" : "还缺锁"}
        </span>
        {partition && (
          <span className="badge lock">
            分区 {partition}
            {tasksEnabled.length ? ` · ${tasksEnabled.join("/")}` : ""}
          </span>
        )}
        {compileReady && !engineDown && <span className="badge ok">编译就绪</span>}
        {compileReady && engineDown && <span className="badge ok">编译可用</span>}
        {engineDown ? (
          <span className="badge warn">双通道不可写 · 禁提交</span>
        ) : minimaxDown && seedanceReady ? (
          <span className="badge warn">备用 Seedance 可写</span>
        ) : (
          <span className="badge ok">引擎就绪</span>
        )}
        {seedanceReady && <span className="badge lock">Seedance Key</span>}
        {pendingRemote && <span className="badge warn">成片生成中，自动刷新</span>}
      </div>

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <h3>白话意图</h3>
            <textarea
              data-testid="studio-intent"
              value={draft.intent}
              onChange={(e) => setDraft({ ...draft, intent: e.target.value })}
              placeholder="例如：雨夜便利店，她把杯子推过去，只说还开着就好。"
            />
            <div className="row">
              <label className="field">
                生成模式
                <select
                  value={draft.mode}
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value as ProjectDraft["mode"] })}
                >
                  <option value="ref2va">参考图生（素材三镜头 · 当前分区默认）</option>
                  <option value="t2va">文生视频（需 T2VA 分区）</option>
                  <option value="fl2va">首尾帧（需 FL2VA 分区）</option>
                </select>
              </label>
              <label className="field">
                时长
                <input
                  type="number"
                  min={4}
                  max={15}
                  value={draft.task.durationSec}
                  onChange={(e) =>
                    setDraft({ ...draft, task: { ...draft.task, durationSec: Number(e.target.value) } })
                  }
                />
              </label>
              <label className="field">
                画幅
                <select
                  value={draft.task.aspectRatio}
                  onChange={(e) =>
                    setDraft({ ...draft, task: { ...draft.task, aspectRatio: e.target.value } })
                  }
                >
                  <option>16:9</option>
                  <option>9:16</option>
                  <option>1:1</option>
                </select>
              </label>
            </div>
          </section>

          <section className="card">
            <h3>场景锁</h3>
            <label className="field">
              场景素材
              <select value={draft.scene.sceneId} onChange={(e) => setSceneId(e.target.value)}>
                <option value="">选择场景</option>
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {sceneAsset && (
              <div className="grid-3" style={{ margin: "10px 0" }}>
                {(["wide", "medium", "close"] as const).map((k) => (
                  <div className="shot" key={k}>
                    {sceneAsset.shots[k] ? <img src={sceneAsset.shots[k]} alt={k} /> : null}
                    <span>{k}</span>
                  </div>
                ))}
              </div>
            )}
            <label className="field">
              空间与定位
              <textarea
                value={draft.scene.space}
                onChange={(e) => setDraft({ ...draft, scene: { ...draft.scene, space: e.target.value } })}
              />
            </label>
            <div className="row">
              <label className="field">
                时间
                <input
                  value={draft.scene.timeOfDay}
                  onChange={(e) => setDraft({ ...draft, scene: { ...draft.scene, timeOfDay: e.target.value } })}
                />
              </label>
              <label className="field">
                天气
                <input
                  value={draft.scene.weather}
                  onChange={(e) => setDraft({ ...draft, scene: { ...draft.scene, weather: e.target.value } })}
                />
              </label>
            </div>
            <label className="field">
              光
              <input
                value={draft.scene.light}
                onChange={(e) => setDraft({ ...draft, scene: { ...draft.scene, light: e.target.value } })}
              />
            </label>
            <label className="field">
              不可变
              <input
                value={draft.scene.immutable}
                onChange={(e) => setDraft({ ...draft, scene: { ...draft.scene, immutable: e.target.value } })}
              />
            </label>
          </section>

          <section className="card">
            <h3>任务锁</h3>
            <label className="field">
              本轮只完成
              <input
                value={draft.task.goal}
                onChange={(e) => setDraft({ ...draft, task: { ...draft.task, goal: e.target.value } })}
              />
            </label>
            <label className="field">
              成功标准
              <input
                value={draft.task.success}
                onChange={(e) => setDraft({ ...draft, task: { ...draft.task, success: e.target.value } })}
              />
            </label>
            <label className="field">
              禁止偏移
              <input
                value={draft.task.forbidden}
                onChange={(e) => setDraft({ ...draft, task: { ...draft.task, forbidden: e.target.value } })}
              />
            </label>
          </section>

          <section className="card">
            <h3>上场人物与空间定位</h3>
            <div className="row" style={{ marginBottom: 8 }}>
              {chars.map((c) => (
                <button
                  key={c.id}
                  className={draft.blocking.some((b) => b.characterId === c.id) ? "btn primary" : "btn ghost"}
                  onClick={() => toggleChar(c.id)}
                  type="button"
                >
                  {c.name}
                </button>
              ))}
            </div>
            {draft.blocking.map((b, i) => {
              const c = assets.find((a) => a.id === b.characterId);
              return (
                <div key={b.characterId} className="job">
                  <strong>{c?.name}</strong>
                  <div className="grid-3" style={{ margin: "8px 0" }}>
                    {c &&
                      (["wide", "medium", "close"] as const).map((k) => (
                        <div className="shot" key={k}>
                          {c.shots[k] ? <img src={c.shots[k]} alt={k} /> : null}
                          <span>{k}</span>
                        </div>
                      ))}
                  </div>
                  <div className="grid-2">
                    <label className="field">
                      站位
                      <input value={b.stance} onChange={(e) => patchBlock(i, { stance: e.target.value })} />
                    </label>
                    <label className="field">
                      朝向
                      <input value={b.bodyFacing} onChange={(e) => patchBlock(i, { bodyFacing: e.target.value })} />
                    </label>
                    <label className="field">
                      视线
                      <input value={b.eyeline} onChange={(e) => patchBlock(i, { eyeline: e.target.value })} />
                    </label>
                    <label className="field">
                      进出画
                      <input value={b.inOut} onChange={(e) => patchBlock(i, { inOut: e.target.value })} />
                    </label>
                    <label className="field">
                      前后景
                      <select value={b.depth} onChange={(e) => patchBlock(i, { depth: e.target.value as typeof b.depth })}>
                        <option value="前">前</option>
                        <option value="中">中</option>
                        <option value="后">后</option>
                      </select>
                    </label>
                    <label className="field">
                      机位
                      <input value={b.camera} onChange={(e) => patchBlock(i, { camera: e.target.value })} />
                    </label>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="card">
            <h3>台词 · 人物 · 音色</h3>
            {draft.lines.map((l, i) => (
              <div key={l.id} className="job stack">
                <div className="row">
                  <label className="field">
                    人物
                    <select value={l.characterId} onChange={(e) => patchLine(i, { characterId: e.target.value })}>
                      {draft.blocking.map((b) => {
                        const c = assets.find((a) => a.id === b.characterId);
                        return (
                          <option key={b.characterId} value={b.characterId}>
                            {c?.name}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="field">
                    音色
                    <select value={l.voiceId} onChange={(e) => patchLine(i, { voiceId: e.target.value })}>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    秒
                    <input
                      type="number"
                      value={l.atSec}
                      onChange={(e) => patchLine(i, { atSec: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <input
                  value={l.emotion}
                  onChange={(e) => patchLine(i, { emotion: e.target.value })}
                  placeholder="情绪"
                />
                <input value={l.text} onChange={(e) => patchLine(i, { text: e.target.value })} placeholder="台词" />
              </div>
            ))}
            <button
              className="btn ghost"
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  lines: [
                    ...draft.lines,
                    {
                      id: `l-${Date.now()}`,
                      characterId: draft.blocking[0]?.characterId || "",
                      voiceId: voices[0]?.id || "",
                      text: "",
                      emotion: "",
                      atSec: 3,
                    },
                  ],
                })
              }
            >
              加一句
            </button>
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <h3>物品</h3>
            {objects.map((o) => (
              <label key={o.id} className="row" style={{ color: "var(--ink)" }}>
                <input
                  type="checkbox"
                  checked={draft.objectIds.includes(o.id)}
                  onChange={() =>
                    setDraft({
                      ...draft,
                      objectIds: draft.objectIds.includes(o.id)
                        ? draft.objectIds.filter((id) => id !== o.id)
                        : [...draft.objectIds, o.id],
                    })
                  }
                />
                {o.name}
              </label>
            ))}
          </section>

          <section className="card">
            <h3>后台提示词</h3>
            <input
              ref={importRef}
              data-testid="studio-import-file"
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importBundle(file);
              }}
            />
            <div className="export-bar" role="toolbar" aria-label="导演包导入">
              <button
                className="btn ghost"
                type="button"
                data-testid="studio-import-bundle"
                onClick={triggerImport}
              >
                导入导演包
              </button>
              <span className="export-meta">jingchang.compile.v1 · 恢复草稿与提示词</span>
            </div>
            {importNote && (
              <p
                data-testid="studio-import-note"
                className="badge ok"
                style={{ marginBottom: 8, whiteSpace: "normal", lineHeight: 1.45 }}
              >
                {importNote}
              </p>
            )}
            <div className="row">
              <button
                className="btn primary"
                type="button"
                data-testid="studio-compile"
                disabled={!!busy}
                onClick={compile}
              >
                {busy === "compile" ? "编译中…" : "生成导演提示词"}
              </button>
              <button
                className="btn"
                type="button"
                disabled={!!busy || engineDown}
                title={
                  engineDown
                    ? "双通道不可写"
                    : minimaxDown && seedanceReady
                      ? "将走 Seedance 备用真写"
                      : undefined
                }
                onClick={submit}
              >
                {busy === "job"
                  ? "入队中…"
                  : engineDown
                    ? "双通道不可写"
                    : minimaxDown && seedanceReady
                      ? "提交成片（备用 Seedance）"
                      : "提交成片"}
              </button>
            </div>
            {compiled?.usedFallback && <p className="badge warn">LLM 失败，已用本地规则回退</p>}
            {error && <p className="badge warn">{error}</p>}
            {compiled && (
              <div className="export-bar" role="toolbar" aria-label="编译导出">
                <button className="btn ghost" type="button" onClick={copyPrompt}>
                  {copied ? "已复制" : "复制提示词"}
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  data-testid="studio-download-bundle"
                  onClick={saveExport}
                >
                  下载导演包
                </button>
                <span className="export-meta">
                  {compiled.provider} · {compiled.locksDigest.slice(0, 12)}…
                </span>
              </div>
            )}
            <div className="prompt-box" data-testid="studio-prompt">
              {compiled?.prompt || "还没有编译。先锁场，再点生成。"}
            </div>
          </section>

          <section className="card">
            <h3>任务队列</h3>
            <div className="row" style={{ marginBottom: 8 }}>
              <button
                className="btn ghost"
                type="button"
                disabled={!pendingRemote}
                onClick={async () => {
                  const out = await json<{ jobs: Job[] }>("/api/jobs", { method: "PATCH" });
                  setJobs(out.jobs);
                }}
              >
                刷新状态
              </button>
            </div>
            {jobs.length === 0 && <p className="lead">还没有成片任务。</p>}
            {jobs.map((j) => (
              <div key={j.id} className="job">
                <div className="row">
                  <span
                    className={
                      j.status === "failed"
                        ? "badge warn"
                        : j.mocked
                          ? "badge warn"
                          : j.status === "succeeded"
                            ? "badge ok"
                            : "badge"
                    }
                  >
                    {j.status}
                  </span>
                  <span className="badge">{j.videoProvider}</span>
                  {j.failover === "seedance" && <span className="badge warn">failover</span>}
                  {j.remoteJobId && <span className="badge">{j.remoteJobId.slice(0, 10)}…</span>}
                </div>
                <p style={{ fontSize: 13, color: "var(--mute)" }}>{j.intent}</p>
                {j.error && (
                  <p className="badge warn" style={{ whiteSpace: "normal", lineHeight: 1.4 }}>
                    {humanizeJobError(j.error)}
                  </p>
                )}
                {j.remoteJobId && j.status === "failed" && (
                  <p style={{ fontSize: 12, color: "var(--mute)" }}>
                    remoteJobId: {j.remoteJobId} · {j.createdAt}
                  </p>
                )}
                {j.videoUrl && <video src={j.videoUrl} controls style={{ width: "100%" }} />}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
