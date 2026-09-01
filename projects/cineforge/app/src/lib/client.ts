import type {
  Asset,
  CompiledPrompt,
  Job,
  LikenessClone,
  ProjectDraft,
  Settings,
  VoiceProfile,
} from "./types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  settings: () => j<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings>) =>
    j<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  assets: () => j<Asset[]>("/api/assets"),
  saveAsset: (a: Partial<Asset>) =>
    j<Asset>("/api/assets", { method: "POST", body: JSON.stringify(a) }),
  deleteAsset: (id: string) => j(`/api/assets?id=${id}`, { method: "DELETE" }),
  voices: () => j<VoiceProfile[]>("/api/voices"),
  saveVoice: (v: Partial<VoiceProfile>) =>
    j<VoiceProfile>("/api/voices", { method: "POST", body: JSON.stringify(v) }),
  humans: () => j<LikenessClone[]>("/api/humans"),
  saveHuman: (h: Partial<LikenessClone>) =>
    j<LikenessClone>("/api/humans", { method: "POST", body: JSON.stringify(h) }),
  jobs: () => j<Job[]>("/api/jobs"),
  compile: (draft: ProjectDraft) =>
    j<CompiledPrompt>("/api/compile", { method: "POST", body: JSON.stringify(draft) }),
  submit: (draft: ProjectDraft, prompt?: string) =>
    j<Job>("/api/jobs", { method: "POST", body: JSON.stringify({ draft, prompt }) }),
  health: () => j<Record<string, unknown>>("/api/health"),
};

export async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error("upload failed");
  const data = (await res.json()) as { url: string };
  return data.url;
}
