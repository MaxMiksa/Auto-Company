import type { Asset, CompiledPrompt, ProjectDraft, Settings, VoiceProfile } from "./types";
import { asCompiled, buildLockBrief, compileLocal } from "./compile";

async function chatComplete(
  base: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const url = `${base.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM ${res.status}: ${t.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("LLM 返回空");
  return text;
}

export async function compilePrompt(
  draft: ProjectDraft,
  settings: Settings,
  assets: Asset[],
  voices: VoiceProfile[],
): Promise<CompiledPrompt> {
  const brief = buildLockBrief(draft, assets, voices);
  const local = compileLocal(draft, assets, voices);

  if (settings.llmProvider === "local") {
    return asCompiled(local, "local", false, draft);
  }

  const system =
    "你是短片导演与提示词编译器。只输出成片提示词正文。必须写入场景空间、任务节拍、每人站位朝向视线、三镜头身份、对白与音色归属。禁止空洞形容词，禁止丢掉锁定项。";

  try {
    if (settings.llmProvider === "vllm") {
      const text = await chatComplete(
        settings.vllmBase,
        "EMPTY",
        settings.vllmModel,
        system,
        brief,
      );
      return asCompiled(text, "vllm", false, draft);
    }
    const text = await chatComplete(
      settings.openaiBase,
      settings.openaiKey,
      settings.openaiModel,
      system,
      brief,
    );
    return asCompiled(text, "openai", false, draft);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM 失败";
    return asCompiled(`${local}\n\n（编译回退：${msg}）`, settings.llmProvider, true, draft);
  }
}
