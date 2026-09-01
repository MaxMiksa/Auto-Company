import type { CompiledPrompt, ProjectDraft } from "./types";

export const COMPILE_EXPORT_SCHEMA = "jingchang.compile.v1" as const;

export interface CompileExportBundle {
  schema: typeof COMPILE_EXPORT_SCHEMA;
  exportedAt: string;
  brand: "镜场";
  draft: ProjectDraft;
  compiled: CompiledPrompt;
  meta: {
    compileOnly: true;
    note: string;
  };
}

/** 构建可下载的编译交付包（不含 Key，可离线保存/分享导演提示词）。 */
export function buildCompileExport(
  draft: ProjectDraft,
  compiled: CompiledPrompt,
): CompileExportBundle {
  return {
    schema: COMPILE_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    brand: "镜场",
    draft,
    compiled,
    meta: {
      compileOnly: true,
      note: "成片需 Omni 或 Seedance Key；此为编译轨交付，非 mock 视频。",
    },
  };
}

export function exportFilename(digest: string): string {
  const slug = digest.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "draft";
  return `jingchang-compile-${slug}.json`;
}

export function downloadCompileExport(bundle: CompileExportBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename(bundle.compiled.locksDigest);
  a.click();
  URL.revokeObjectURL(url);
}
