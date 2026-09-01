import type { JobStatus, Settings } from "@/lib/types";

export type SubmitResult = {
  remoteJobId?: string;
  mocked: boolean;
  blocked?: boolean;
  error?: string;
  videoUrl?: string;
};

/** env 优先于 settings；禁止把 Key 打进公开仓。 */
export function resolveSeedanceKey(settings: Settings): string {
  return (
    process.env.SEEDANCE_API_KEY?.trim() ||
    process.env.ARK_API_KEY?.trim() ||
    settings.seedanceKey?.trim() ||
    ""
  );
}

export function resolveSeedanceModel(settings: Settings): string {
  return (
    process.env.SEEDANCE_MODEL?.trim() ||
    settings.seedanceModel?.trim() ||
    "doubao-seedance-1-0-pro-250528"
  );
}

export function seedanceReady(settings: Settings): boolean {
  return Boolean(resolveSeedanceKey(settings));
}

function apiBase(settings: Settings): string {
  return settings.seedanceBase.replace(/\/$/, "");
}

function authHeaders(key: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

/** 将参考图 buffer 编成 data URL，供 Ark image_url 内容块使用。 */
export function buffersToDataUrls(
  refs: { buf: Buffer; filename: string }[],
  limit = 3,
): string[] {
  return refs.slice(0, limit).map((r) => {
    const isJpeg = r.filename.toLowerCase().endsWith(".jpg") || r.filename.toLowerCase().endsWith(".jpeg");
    const mime = isJpeg ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${r.buf.toString("base64")}`;
  });
}

export async function submitSeedance(opts: {
  settings: Settings;
  prompt: string;
  duration: number;
  aspectRatio: string;
  imageDataUrls?: string[];
}): Promise<SubmitResult> {
  const key = resolveSeedanceKey(opts.settings);
  if (!key) {
    return {
      mocked: false,
      blocked: true,
      error: "Seedance 未配置 Key（SEEDANCE_API_KEY / ARK_API_KEY 或设置页）。备用通道不可写。",
    };
  }

  const model = resolveSeedanceModel(opts.settings);
  const duration = Math.min(12, Math.max(2, Math.round(opts.duration)));
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: opts.prompt.slice(0, 4000),
    },
  ];
  for (const url of opts.imageDataUrls ?? []) {
    content.push({
      type: "image_url",
      image_url: { url },
    });
  }

  const body: Record<string, unknown> = {
    model,
    content,
    ratio: opts.aspectRatio,
    duration,
    watermark: false,
  };

  const url = `${apiBase(opts.settings)}/contents/generations/tasks`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const t = await res.text();
      return {
        mocked: false,
        blocked: true,
        error: `Seedance 提交失败 ${res.status}：${t.slice(0, 280)}`,
      };
    }
    const data = (await res.json()) as { id?: string; task_id?: string };
    const remoteJobId = data.id || data.task_id;
    if (!remoteJobId) {
      return { mocked: false, blocked: true, error: "Seedance 未返回任务 id" };
    }
    return { remoteJobId, mocked: false };
  } catch (err) {
    return {
      mocked: false,
      blocked: true,
      error: err instanceof Error ? err.message : "seedance submit failed",
    };
  }
}

function mapStatus(raw: string): JobStatus {
  const s = raw.toLowerCase();
  if (s === "succeeded" || s === "success" || s === "completed") return "succeeded";
  if (s === "failed" || s === "error" || s === "cancelled" || s === "canceled") return "failed";
  if (s === "running" || s === "processing" || s === "generating") return "running";
  return "queued";
}

export async function getSeedanceJob(
  settings: Settings,
  remoteJobId: string,
): Promise<{
  status: JobStatus;
  videoUrl?: string;
  error?: string;
}> {
  const key = resolveSeedanceKey(settings);
  if (!key) throw new Error("Seedance Key 缺失，无法轮询");

  const res = await fetch(
    `${apiBase(settings)}/contents/generations/tasks/${encodeURIComponent(remoteJobId)}`,
    {
      headers: authHeaders(key),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Seedance 查询失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    status?: string;
    content?: { video_url?: string };
    error?: { message?: string; code?: string } | string;
  };
  let error: string | undefined;
  if (data.error != null) {
    error =
      typeof data.error === "string"
        ? data.error
        : [data.error.code, data.error.message].filter(Boolean).join(" · ") ||
          JSON.stringify(data.error).slice(0, 300);
  }
  return {
    status: mapStatus(data.status || "queued"),
    videoUrl: data.content?.video_url,
    error,
  };
}

export async function downloadSeedanceVideo(videoUrl: string): Promise<Buffer> {
  const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Seedance 视频下载失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
