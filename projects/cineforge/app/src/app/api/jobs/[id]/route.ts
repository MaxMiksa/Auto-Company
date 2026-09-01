import { NextResponse } from "next/server";
import { readStore, patchJob, saveUpload } from "@/server/persist";
import {
  downloadMinimaxVideo,
  getMinimaxJob,
} from "@/server/providers/minimax";
import {
  downloadSeedanceVideo,
  getSeedanceJob,
} from "@/server/providers/seedance";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const data = await readStore();
  const job = data.jobs.find((j) => j.id === id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}

/** 刷新单个任务状态。 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const data = await readStore();
  const job = data.jobs.find((j) => j.id === id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (job.mocked || !job.remoteJobId) {
    return NextResponse.json(job);
  }
  if (job.status === "succeeded" || job.status === "failed") {
    return NextResponse.json(job);
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
          return NextResponse.json(next);
        }
        const buf = await downloadSeedanceVideo(remote.videoUrl);
        const url = await saveUpload(`${job.id}.mp4`, buf);
        const next = await patchJob(job.id, {
          status: "succeeded",
          videoUrl: url,
          error: undefined,
        });
        return NextResponse.json(next);
      }
      if (remote.status === "failed") {
        const next = await patchJob(job.id, {
          status: "failed",
          error: remote.error || "Seedance 远程生成失败",
        });
        return NextResponse.json(next);
      }
      const next = await patchJob(job.id, { status: remote.status });
      return NextResponse.json(next);
    }

    if (job.videoProvider !== "minimax-h3") {
      return NextResponse.json(job);
    }

    const remote = await getMinimaxJob(data.settings, job.remoteJobId);
    if (remote.status === "succeeded") {
      const buf = await downloadMinimaxVideo(data.settings, job.remoteJobId);
      const url = await saveUpload(`${job.id}.mp4`, buf);
      const next = await patchJob(job.id, {
        status: "succeeded",
        videoUrl: url,
        error: undefined,
      });
      return NextResponse.json(next);
    }
    if (remote.status === "failed") {
      const next = await patchJob(job.id, {
        status: "failed",
        error: remote.error || "远程生成失败",
      });
      return NextResponse.json(next);
    }
    const next = await patchJob(job.id, { status: remote.status });
    return NextResponse.json(next);
  } catch (err) {
    const next = await patchJob(job.id, {
      error: err instanceof Error ? err.message : "轮询失败",
    });
    return NextResponse.json(next);
  }
}
