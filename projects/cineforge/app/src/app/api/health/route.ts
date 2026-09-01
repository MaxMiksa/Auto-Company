import { NextResponse } from "next/server";
import { readStore } from "@/server/persist";
import { minimaxHealth } from "@/server/providers/minimax";
import {
  resolveSeedanceModel,
  seedanceReady,
} from "@/server/providers/seedance";

export async function GET() {
  const { settings } = await readStore();
  const mm = await minimaxHealth(settings);
  const sdReady = seedanceReady(settings);
  const writable = mm.ok || sdReady;

  let llm = { ok: settings.llmProvider === "local", detail: "local 规则编译" };
  if (settings.llmProvider === "vllm") {
    try {
      const res = await fetch(`${settings.vllmBase.replace(/\/$/, "")}/models`, {
        signal: AbortSignal.timeout(6000),
      });
      llm = { ok: res.ok, detail: res.ok ? "vLLM 可达" : `HTTP ${res.status}` };
    } catch (err) {
      llm = { ok: false, detail: err instanceof Error ? err.message : "down" };
    }
  }
  if (settings.llmProvider === "openai") {
    llm = {
      ok: Boolean(settings.openaiKey),
      detail: settings.openaiKey ? "已配置 Key" : "缺少 OpenAI Key",
    };
  }

  const compileReady = llm.ok;

  return NextResponse.json({
    writable,
    compileReady,
    videoProvider: settings.videoProvider,
    llmProvider: settings.llmProvider,
    brand: "镜场",
    defaults: {
      videoProvider: "minimax-h3",
      llmProvider: "local",
      generateMode: "ref2va",
      reason:
        "局域网 MiniMax 为首发默认；Omni 降级且配置 Seedance Key 时可自动 failover 真写",
    },
    minimax: mm,
    llm,
    seedance: {
      ready: sdReady,
      ok: sdReady,
      model: resolveSeedanceModel(settings),
      detail: sdReady
        ? "Key 已就绪（env 或设置），可作备用真写"
        : "未配置 Key，备用通道不可用",
    },
  });
}
