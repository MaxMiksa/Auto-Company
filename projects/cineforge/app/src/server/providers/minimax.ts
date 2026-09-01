import { readFile } from "fs/promises";
import path from "path";
import type { Asset, GenerateMode, Settings } from "@/lib/types";
import { hashColor, solidPng } from "@/server/png";
import { uploadPath } from "@/server/persist";

function base(settings: Settings): string {
  return settings.minimaxBase.replace(/\/$/, "");
}

export interface MinimaxMeta {
  partition: string;
  tasks_enabled: GenerateMode[];
  defaults?: { duration?: number; aspect_ratio?: string; quality?: string };
}

export interface MinimaxHealth {
  ok: boolean;
  detail: string;
  meta?: MinimaxMeta;
  proxyUp?: boolean;
  omniOk?: boolean;
  status?: string;
}

export async function minimaxHealth(settings: Settings): Promise<MinimaxHealth> {
  try {
    const res = await fetch(`${base(settings)}/health`, {
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let parsed: {
      status?: string;
      proxy?: string;
      omni?: { status?: string; http_status?: number };
    } | null = null;
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      parsed = null;
    }

    let meta: MinimaxMeta | undefined;
    try {
      const m = await fetch(`${base(settings)}/v1/meta`, {
        signal: AbortSignal.timeout(8000),
      });
      if (m.ok) meta = (await m.json()) as MinimaxMeta;
    } catch {
      /* meta 可选 */
    }

    const proxyUp = parsed?.proxy === "up" || res.ok;
    const omniOk =
      parsed?.omni?.status === "ok" ||
      (parsed?.status === "ok" && res.ok && parsed?.omni?.status !== "error");
    const status = parsed?.status || (res.ok ? "ok" : "error");
    /** 仅 status=ok 且 HTTP 200 才算可写；proxy up + omni error = 不可服务 */
    const ok = res.ok && status === "ok" && omniOk !== false;

    return {
      ok,
      detail: text.slice(0, 320),
      meta,
      proxyUp,
      omniOk: Boolean(omniOk),
      status,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "unreachable" };
  }
}

async function dataUrlToBuffer(src: string): Promise<Buffer | null> {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(src);
  if (m) return Buffer.from(m[2], "base64");
  if (src.startsWith("data:image/svg+xml")) {
    const comma = src.indexOf(",");
    if (comma < 0) return null;
    const payload = src.slice(comma + 1);
    const decoded = src.includes(";base64,")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    return solidPng(640, 360, hashColor(decoded.slice(0, 120)));
  }
  return null;
}

async function resolveShotBuffer(
  src: string,
  label: string,
): Promise<{ buf: Buffer; filename: string } | null> {
  if (!src) return null;
  if (src.startsWith("data:")) {
    const buf = await dataUrlToBuffer(src);
    if (!buf) return null;
    const isPng = buf[0] === 0x89;
    return { buf, filename: `${label}.${isPng ? "png" : "bin"}` };
  }
  if (src.startsWith("/api/files/")) {
    const name = path.basename(src);
    try {
      const buf = await readFile(uploadPath(name));
      return { buf, filename: name };
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(src)) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = src.includes(".jpg") || src.includes(".jpeg") ? "jpg" : "png";
      return { buf, filename: `${label}.${ext}` };
    } catch {
      return null;
    }
  }
  return { buf: solidPng(640, 360, hashColor(label + src)), filename: `${label}.png` };
}

/** 从素材三镜头挑最多 9 张身份/场参考图。优先人物特写 → 场景中景 → 物品特写。 */
export async function collectRefImages(
  assets: Asset[],
  sceneId: string,
  characterIds: string[],
  objectIds: string[],
): Promise<{ buf: Buffer; filename: string }[]> {
  const picks: { src: string; label: string }[] = [];
  const scene = assets.find((a) => a.id === sceneId);
  const chars = assets.filter((a) => characterIds.includes(a.id));
  const objects = assets.filter((a) => objectIds.includes(a.id));

  for (const c of chars) {
    picks.push({ src: c.shots.close, label: `${c.id}-close` });
    picks.push({ src: c.shots.medium, label: `${c.id}-medium` });
  }
  if (scene) {
    picks.push({ src: scene.shots.medium, label: `${scene.id}-medium` });
    picks.push({ src: scene.shots.wide, label: `${scene.id}-wide` });
    picks.push({ src: scene.shots.close, label: `${scene.id}-close` });
  }
  for (const o of objects) {
    picks.push({ src: o.shots.close, label: `${o.id}-close` });
  }
  for (const c of chars) {
    picks.push({ src: c.shots.wide, label: `${c.id}-wide` });
  }

  const out: { buf: Buffer; filename: string }[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    if (out.length >= 9) break;
    if (!p.src || seen.has(p.src)) continue;
    seen.add(p.src);
    const resolved = await resolveShotBuffer(p.src, p.label);
    if (resolved) out.push(resolved);
  }
  return out;
}

export async function submitMinimax(opts: {
  settings: Settings;
  prompt: string;
  mode: GenerateMode;
  duration: number;
  aspectRatio: string;
  refImages?: { buf: Buffer; filename: string }[];
}): Promise<{
  remoteJobId?: string;
  mocked: boolean;
  blocked?: boolean;
  error?: string;
  videoUrl?: string;
}> {
  const health = await minimaxHealth(opts.settings);
  if (!health.ok) {
    const reason =
      health.status === "degraded" || health.omniOk === false
        ? "成片引擎 Omni/Stage-0 不可用（代理仍在，推理副本挂死）。恢复前禁止真入队。"
        : `MiniMax 不可达：${health.detail}`;
    return { mocked: false, blocked: true, error: reason };
  }

  const enabled = health.meta?.tasks_enabled ?? [];
  let mode = opts.mode;
  if (enabled.length && !enabled.includes(mode)) {
    if (enabled.includes("ref2va")) mode = "ref2va";
    else mode = enabled[0];
  }

  if (mode === "ref2va" && (!opts.refImages || opts.refImages.length === 0)) {
    return {
      mocked: false,
      blocked: true,
      error: "当前分区仅 Ref2VA，但没有可用参考图。请先在素材库上传三镜头。",
    };
  }

  const form = new FormData();
  form.set("prompt", opts.prompt.slice(0, 7000));
  form.set("duration", String(opts.duration));
  form.set("fps", "24");
  form.set("num_inference_steps", "40");
  form.set("flow_shift", "12");
  form.set("audio_flow_shift", "3");
  form.set("seed", "1101");
  form.set("quality", health.meta?.defaults?.quality || "lossless");
  form.set("aspect_ratio", opts.aspectRatio);
  form.set("task", mode);
  form.set("num_outputs_per_prompt", "1");

  if (opts.refImages) {
    for (const img of opts.refImages) {
      const bytes = new Uint8Array(img.buf);
      form.append(
        "images",
        new Blob([bytes], { type: "image/png" }),
        img.filename.endsWith(".png") ? img.filename : `${img.filename}.png`,
      );
    }
  }

  try {
    const res = await fetch(`${base(opts.settings)}/v1/generate/async`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const t = await res.text();
      return {
        mocked: false,
        blocked: true,
        error: `MiniMax ${res.status}：${t.slice(0, 240)}`,
      };
    }
    const data = (await res.json()) as { job_id?: string };
    if (!data.job_id) {
      return { mocked: false, blocked: true, error: "MiniMax 未返回 job_id" };
    }
    return { remoteJobId: data.job_id, mocked: false };
  } catch (err) {
    return {
      mocked: false,
      blocked: true,
      error: err instanceof Error ? err.message : "submit failed",
    };
  }
}

export async function getMinimaxJob(
  settings: Settings,
  remoteJobId: string,
): Promise<{
  status: "queued" | "running" | "succeeded" | "failed";
  videoPath?: string;
  error?: string;
}> {
  const res = await fetch(`${base(settings)}/v1/jobs/${encodeURIComponent(remoteJobId)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`查询失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    status: "queued" | "running" | "succeeded" | "failed";
    video_url?: string | null;
    error?: unknown;
  };
  let error: string | undefined;
  if (data.error != null) {
    error = typeof data.error === "string" ? data.error : JSON.stringify(data.error).slice(0, 300);
  }
  return {
    status: data.status,
    videoPath: data.video_url || undefined,
    error,
  };
}

export async function downloadMinimaxVideo(
  settings: Settings,
  remoteJobId: string,
): Promise<Buffer> {
  const res = await fetch(
    `${base(settings)}/v1/jobs/${encodeURIComponent(remoteJobId)}/video`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`下载失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
