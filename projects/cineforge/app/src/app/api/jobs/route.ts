import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import type { Job, ProjectDraft, VideoProvider } from "@/lib/types";
import { compilePrompt } from "@/lib/llm";
import { addJob, patchJob, readStore, saveUpload } from "@/server/persist";
import {
  collectRefImages,
  downloadMinimaxVideo,
  getMinimaxJob,
  minimaxHealth,
  submitMinimax,
} from "@/server/providers/minimax";
import {
  buffersToDataUrls,
  downloadSeedanceVideo,
  getSeedanceJob,
  resolveSeedanceModel,
  seedanceReady,
  submitSeedance,
} from "@/server/providers/seedance";

export async function GET() {
  const data = await readStore();
  return NextResponse.json(data.jobs);
}

export async function POST(req: Request) {
  const body = (await req.json()) as { draft: ProjectDraft; prompt?: string };
  const data = await readStore();
  const compiled =
    body.prompt?.trim()
      ? { prompt: body.prompt, provider: data.settings.llmProvider, usedFallback: false }
      : await compilePrompt(body.draft, data.settings, data.assets, data.voices);

  const settings = data.settings;
  const mm = await minimaxHealth(settings);
  const sdReady = seedanceReady(settings);
  const preferSeedance = settings.videoProvider === "seedance-2.0";

  let videoProvider: VideoProvider = preferSeedance ? "seedance-2.0" : "minimax-h3";
  let failover: Job["failover"];
  let submitted: {
    remoteJobId?: string;
    mocked: boolean;
    blocked?: boolean;
    error?: string;
    videoUrl?: string;
  };

  const refImages = await collectRefImages(
    data.assets,
    body.draft.scene.sceneId,
    body.draft.blocking.map((b) => b.characterId),
    body.draft.objectIds,
  );

  if (preferSeedance) {
    if (!sdReady) {
      submitted = {
        mocked: false,
        blocked: true,
        error: "已选 Seedance，但未配置 Key。请设 SEEDANCE_API_KEY / ARK_API_KEY 或到设置页填写。",
      };
    } else {
      submitted = await submitSeedance({
        settings,
        prompt: compiled.prompt,
        duration: body.draft.task.durationSec,
        aspectRatio: body.draft.task.aspectRatio,
        imageDataUrls: buffersToDataUrls(refImages),
      });
    }
  } else if (mm.ok) {
    submitted = await submitMinimax({
      settings,
      prompt: compiled.prompt,
      mode: body.draft.mode,
      duration: body.draft.task.durationSec,
      aspectRatio: body.draft.task.aspectRatio,
      refImages,
    });
  } else if (sdReady) {
    videoProvider = "seedance-2.0";
    failover = "seedance";
    submitted = await submitSeedance({
      settings,
      prompt: compiled.prompt,
      duration: body.draft.task.durationSec,
      aspectRatio: body.draft.task.aspectRatio,
      imageDataUrls: buffersToDataUrls(refImages),
    });
  } else {
    submitted = {
      mocked: false,
      blocked: true,
      error:
        "双通道不可写：MiniMax Omni/Stage-0 降级，且未配置 Seedance Key。恢复 Omni 或配置 SEEDANCE_API_KEY 后重试。",
    };
  }

  const status = submitted.blocked
    ? "failed"
    : submitted.mocked
      ? "mocked"
      : "queued";

  const job: Job = {
    id: `job-${nanoid(8)}`,
    createdAt: new Date().toISOString(),
    status,
    videoProvider,
    mode: body.draft.mode,
    prompt: compiled.prompt,
    intent: body.draft.intent,
    remoteJobId: submitted.remoteJobId,
    videoUrl: submitted.videoUrl,
    error: submitted.error,
    mocked: Boolean(submitted.mocked),
    failover,
  };
  await addJob(job);
  return NextResponse.json({
    ...job,
    meta: {
      model: videoProvider === "seedance-2.0" ? resolveSeedanceModel(settings) : undefined,
      failover: Boolean(failover),
    },
  });
}

/** 刷新所有未完成的远程任务；成功则落盘视频。按 job.videoProvider 分支。 */
export async function PATCH() {
  const data = await readStore();
  const updated: Job[] = [];

  for (const job of data.jobs) {
    if (
      job.mocked ||
      !job.remoteJobId ||
      job.status === "succeeded" ||
      job.status === "failed" ||
      job.status === "mocked"
    ) {
      continue;
    }
    try {
      if (job.videoProvider === "seedance-2.0") {
        const remote = await getSeedanceJob(data.settings, job.remoteJobId);
        if (remote.status === "succeeded") {
          if (!remote.videoUrl) {
            const next = await patchJob(job.id, {
              status: "failed",
              error: "Seedance 成功但无 video_url",
            });
            if (next) updated.push(next);
            continue;
          }
          const buf = await downloadSeedanceVideo(remote.videoUrl);
          const url = await saveUpload(`${job.id}.mp4`, buf);
          const next = await patchJob(job.id, {
            status: "succeeded",
            videoUrl: url,
            error: undefined,
          });
          if (next) updated.push(next);
        } else if (remote.status === "failed") {
          const next = await patchJob(job.id, {
            status: "failed",
            error: remote.error || "Seedance 远程生成失败",
          });
          if (next) updated.push(next);
        } else {
          const next = await patchJob(job.id, { status: remote.status });
          if (next) updated.push(next);
        }
        continue;
      }

      if (job.videoProvider !== "minimax-h3") continue;

      const remote = await getMinimaxJob(data.settings, job.remoteJobId);
      if (remote.status === "succeeded") {
        const buf = await downloadMinimaxVideo(data.settings, job.remoteJobId);
        const url = await saveUpload(`${job.id}.mp4`, buf);
        const next = await patchJob(job.id, {
          status: "succeeded",
          videoUrl: url,
          error: undefined,
        });
        if (next) updated.push(next);
      } else if (remote.status === "failed") {
        const next = await patchJob(job.id, {
          status: "failed",
          error: remote.error || "远程生成失败",
        });
        if (next) updated.push(next);
      } else {
        const next = await patchJob(job.id, { status: remote.status });
        if (next) updated.push(next);
      }
    } catch (err) {
      const next = await patchJob(job.id, {
        error: err instanceof Error ? err.message : "轮询失败",
      });
      if (next) updated.push(next);
    }
  }

  const fresh = await readStore();
  return NextResponse.json({ updated: updated.length, jobs: fresh.jobs });
}
