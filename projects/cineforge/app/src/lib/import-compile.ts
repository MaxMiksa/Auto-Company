import type { CompiledPrompt, ProjectDraft } from "./types";
import { COMPILE_EXPORT_SCHEMA, type CompileExportBundle } from "./export-compile";

export type ImportCompileResult =
  | { ok: true; bundle: CompileExportBundle; draft: ProjectDraft; compiled: CompiledPrompt }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 校验并解析 jingchang.compile.v1 导演包（客户端导入用）。 */
export function parseCompileExport(raw: unknown): ImportCompileResult {
  if (!isRecord(raw)) {
    return { ok: false, error: "不是有效的 JSON 对象" };
  }

  if (raw.schema !== COMPILE_EXPORT_SCHEMA) {
    return {
      ok: false,
      error: `schema 不匹配：期望 ${COMPILE_EXPORT_SCHEMA}，收到 ${String(raw.schema)}`,
    };
  }

  if (raw.brand !== "镜场") {
    return { ok: false, error: "brand 必须为「镜场」" };
  }

  const meta = raw.meta;
  if (!isRecord(meta) || meta.compileOnly !== true) {
    return { ok: false, error: "meta.compileOnly 必须为 true（此为编译轨交付，非成片）" };
  }

  const draft = raw.draft;
  const compiled = raw.compiled;
  if (!isRecord(draft) || !isRecord(compiled)) {
    return { ok: false, error: "缺少 draft 或 compiled 字段" };
  }

  const prompt = compiled.prompt;
  const locksDigest = compiled.locksDigest;
  if (typeof prompt !== "string" || prompt.trim().length < 40) {
    return { ok: false, error: "compiled.prompt 过短或缺失" };
  }
  if (typeof locksDigest !== "string" || !locksDigest.trim()) {
    return { ok: false, error: "compiled.locksDigest 缺失" };
  }

  const intent = draft.intent;
  if (typeof intent !== "string") {
    return { ok: false, error: "draft.intent 缺失" };
  }

  const bundle = raw as unknown as CompileExportBundle;
  return {
    ok: true,
    bundle,
    draft: bundle.draft,
    compiled: bundle.compiled,
  };
}

/** 从 File 读取并解析导演包。 */
export async function readCompileExportFile(file: File): Promise<ImportCompileResult> {
  if (!file.name.endsWith(".json")) {
    return { ok: false, error: "请选择 .json 导演包文件" };
  }
  if (file.size > 512_000) {
    return { ok: false, error: "文件过大（上限 512KB）" };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "无法读取文件" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON 解析失败" };
  }

  return parseCompileExport(parsed);
}
