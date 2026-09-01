export type AssetKind = "character" | "scene" | "object";
export type ShotKey = "wide" | "medium" | "close";
export type VideoProvider = "minimax-h3" | "seedance-2.0";
export type LlmProvider = "local" | "vllm" | "openai";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "mocked";
export type GenerateMode = "t2va" | "fl2va" | "ref2va";

export interface TripleShots {
  wide: string;
  medium: string;
  close: string;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  description: string;
  doNotTransfer: string;
  shots: TripleShots;
  createdAt: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  description: string;
  sampleUrl: string;
  useFor: "dialogue" | "narration" | "both";
  createdAt: string;
  cloneStatus: "ready" | "queued" | "failed";
}

export interface LikenessClone {
  id: string;
  name: string;
  consent: string;
  characterId: string;
  defaultVoiceId: string;
  notes: string;
  createdAt: string;
  cloneStatus: "ready" | "queued" | "failed";
}

export interface SceneLock {
  sceneId: string;
  name: string;
  space: string;
  timeOfDay: string;
  weather: string;
  light: string;
  props: string;
  immutable: string;
}

export interface TaskLock {
  goal: string;
  success: string;
  forbidden: string;
  durationSec: number;
  aspectRatio: string;
}

export interface BlockingEntry {
  characterId: string;
  stance: string;
  bodyFacing: string;
  eyeline: string;
  inOut: string;
  depth: "前" | "中" | "后";
  camera: string;
  lensFeel: string;
}

export interface DialogueLine {
  id: string;
  characterId: string;
  voiceId: string;
  text: string;
  emotion: string;
  atSec: number;
}

export interface ProjectDraft {
  intent: string;
  mode: GenerateMode;
  scene: SceneLock;
  task: TaskLock;
  blocking: BlockingEntry[];
  objectIds: string[];
  lines: DialogueLine[];
}

export interface CompiledPrompt {
  prompt: string;
  provider: LlmProvider;
  usedFallback: boolean;
  locksDigest: string;
}

export interface Settings {
  videoProvider: VideoProvider;
  minimaxBase: string;
  seedanceBase: string;
  seedanceModel: string;
  seedanceKey: string;
  llmProvider: LlmProvider;
  vllmBase: string;
  vllmModel: string;
  openaiBase: string;
  openaiModel: string;
  openaiKey: string;
}

export interface Job {
  id: string;
  createdAt: string;
  status: JobStatus;
  videoProvider: VideoProvider;
  mode: GenerateMode;
  prompt: string;
  intent: string;
  remoteJobId?: string;
  videoUrl?: string;
  error?: string;
  mocked: boolean;
  /** MiniMax 不可写时自动切到 Seedance 的标记 */
  failover?: "seedance";
}

export interface StoreData {
  settings: Settings;
  assets: Asset[];
  voices: VoiceProfile[];
  humans: LikenessClone[];
  jobs: Job[];
}

export const SHOT_LABEL: Record<ShotKey, string> = {
  wide: "建立 / 全身",
  medium: "中景 / 3/4",
  close: "特写 / 身份锚",
};

export const KIND_LABEL: Record<AssetKind, string> = {
  character: "人物",
  scene: "场景",
  object: "物品",
};

export const DEFAULT_SETTINGS: Settings = {
  videoProvider: "minimax-h3",
  minimaxBase: "http://58.241.131.10:8088",
  seedanceBase: "https://ark.cn-beijing.volces.com/api/v3",
  /** 有 2.0 开通时用 env SEEDANCE_MODEL=doubao-seedance-2-0-260128 覆盖 */
  seedanceModel: "doubao-seedance-1-0-pro-250528",
  seedanceKey: "",
  llmProvider: "local",
  vllmBase: "http://58.241.131.10:30000/v1",
  vllmModel: "Qwen/Qwen3.8-27B",
  openaiBase: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
  openaiKey: "",
};

export function emptyDraft(): ProjectDraft {
  return {
    intent: "",
    mode: "ref2va",
    scene: {
      sceneId: "",
      name: "",
      space: "",
      timeOfDay: "夜",
      weather: "室内干燥",
      light: "",
      props: "",
      immutable: "",
    },
    task: {
      goal: "",
      success: "",
      forbidden: "禁止换场、换主角、改脸、改声线归属、中途换题",
      durationSec: 8,
      aspectRatio: "16:9",
    },
    blocking: [],
    objectIds: [],
    lines: [],
  };
}
