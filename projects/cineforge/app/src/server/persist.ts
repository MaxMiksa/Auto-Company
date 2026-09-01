import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import {
  DEFAULT_SETTINGS,
  type Asset,
  type AssetKind,
  type Job,
  type LikenessClone,
  type Settings,
  type StoreData,
  type VoiceProfile,
} from "@/lib/types";
import { composeShotPng, pngDataUrl } from "@/server/png";

const ROOT = path.join(process.cwd(), ".data");
const STORE = path.join(ROOT, "store.json");
const UPLOADS = path.join(ROOT, "uploads");

type Palette = [[number, number, number], [number, number, number]];

function triple(
  kind: AssetKind,
  name: string,
  palette: Palette,
): { wide: string; medium: string; close: string } {
  return {
    wide: pngDataUrl(composeShotPng({ kind, framing: "wide", name, palette })),
    medium: pngDataUrl(composeShotPng({ kind, framing: "medium", name, palette })),
    close: pngDataUrl(composeShotPng({ kind, framing: "close", name, palette })),
  };
}

function isPlaceholderShot(src: string): boolean {
  return !src || src.startsWith("data:image/svg+xml");
}

/** 把旧 SVG 色块种子升级为构图 PNG（仅改种子四件套的占位镜头）。 */
function upgradeSeedAssets(assets: Asset[]): { assets: Asset[]; changed: boolean } {
  const palettes: Record<string, Palette> = {
    "scene-rain-store": [
      [26, 20, 16],
      [232, 194, 122],
    ],
    "char-lin": [
      [20, 24, 28],
      [201, 212, 192],
    ],
    "char-zhou": [
      [28, 24, 20],
      [216, 196, 160],
    ],
    "obj-kettle": [
      [18, 20, 16],
      [184, 196, 168],
    ],
  };
  let changed = false;
  const next = assets.map((a) => {
    const palette = palettes[a.id];
    if (!palette) return a;
    if (
      !isPlaceholderShot(a.shots.wide) &&
      !isPlaceholderShot(a.shots.medium) &&
      !isPlaceholderShot(a.shots.close)
    ) {
      return a;
    }
    changed = true;
    return { ...a, shots: triple(a.kind, a.name, palette) };
  });
  return { assets: next, changed };
}

function seed(): StoreData {
  const now = new Date().toISOString();
  const cafe: Asset = {
    id: "scene-rain-store",
    kind: "scene",
    name: "雨夜便利店",
    description:
      "街角独立便利店，暖黄灯箱「24H」，玻璃门挂着风铃。货架到胸口高，冷柜在右侧，收银台靠左窗。地砖深灰湿痕，窗外霓虹倒映在积水里。",
    doNotTransfer: "不要把店改成超市或咖啡馆；不要改招牌字。",
    shots: triple("scene", "雨夜便利店", [
      [26, 20, 16],
      [232, 194, 122],
    ]),
    createdAt: now,
  };
  const lin: Asset = {
    id: "char-lin",
    kind: "character",
    name: "林晚",
    description:
      "二十七八，短发耳下，左眉一道浅疤，旧军绿外套，内白T，右手戴细银戒。神情克制，说话时先看对方再开口。",
    doNotTransfer: "不要年轻化、不要换发型、不要去掉眉疤。",
    shots: triple("character", "林晚", [
      [20, 24, 28],
      [201, 212, 192],
    ]),
    createdAt: now,
  };
  const zhou: Asset = {
    id: "char-zhou",
    kind: "character",
    name: "周叔",
    description:
      "五十出头，便利店店主，灰蓝围裙，袖口磨白，金丝眼镜，声音低而慢。站柜台时习惯双手撑台沿。",
    doNotTransfer: "不要换成年轻人；眼镜必须在。",
    shots: triple("character", "周叔", [
      [28, 24, 20],
      [216, 196, 160],
    ]),
    createdAt: now,
  };
  const kettle: Asset = {
    id: "obj-kettle",
    kind: "object",
    name: "缺口搪瓷杯",
    description: "米白搪瓷杯，杯口一处小缺，杯身褪色蓝边，盛半杯热茶，蒸汽可见。",
    doNotTransfer: "不要变成纸杯或马克杯。",
    shots: triple("object", "缺口搪瓷杯", [
      [18, 20, 16],
      [184, 196, 168],
    ]),
    createdAt: now,
  };
  const voices: VoiceProfile[] = [
    {
      id: "voice-lin",
      name: "林晚 · 低语",
      description: "女声中低，气音略重，语速偏慢，情绪压着。",
      sampleUrl: "",
      useFor: "dialogue",
      createdAt: now,
      cloneStatus: "ready",
    },
    {
      id: "voice-zhou",
      name: "周叔 · 柜台",
      description: "男声偏低，略带鼻音，句尾落下。",
      sampleUrl: "",
      useFor: "dialogue",
      createdAt: now,
      cloneStatus: "ready",
    },
  ];
  const humans: LikenessClone[] = [
    {
      id: "human-lin",
      name: "林晚（示例形象，非真人授权演示）",
      consent: "演示数据，仅用于界面走通，不可当作真人克隆。",
      characterId: lin.id,
      defaultVoiceId: "voice-lin",
      notes: "身份以人物三镜头为准。",
      createdAt: now,
      cloneStatus: "ready",
    },
  ];
  return {
    settings: DEFAULT_SETTINGS,
    assets: [cafe, lin, zhou, kettle],
    voices,
    humans,
    jobs: [],
  };
}

async function ensure(): Promise<StoreData> {
  await mkdir(UPLOADS, { recursive: true });
  try {
    const raw = await readFile(STORE, "utf8");
    const data = JSON.parse(raw) as StoreData;
    const upgraded = upgradeSeedAssets(data.assets ?? []);
    const next: StoreData = {
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
      assets: upgraded.assets,
      voices: data.voices ?? [],
      humans: data.humans ?? [],
      jobs: data.jobs ?? [],
    };
    if (upgraded.changed) await writeStore(next);
    return next;
  } catch {
    const data = seed();
    await writeFile(STORE, JSON.stringify(data, null, 2));
    return data;
  }
}

export async function readStore(): Promise<StoreData> {
  return ensure();
}

export async function writeStore(data: StoreData): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  await writeFile(STORE, JSON.stringify(data, null, 2));
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const data = await ensure();
  data.settings = { ...data.settings, ...patch };
  await writeStore(data);
  return data.settings;
}

export async function upsertAsset(asset: Asset): Promise<Asset> {
  const data = await ensure();
  const i = data.assets.findIndex((a) => a.id === asset.id);
  if (i >= 0) data.assets[i] = asset;
  else data.assets.unshift(asset);
  await writeStore(data);
  return asset;
}

export async function deleteAsset(id: string): Promise<void> {
  const data = await ensure();
  data.assets = data.assets.filter((a) => a.id !== id);
  await writeStore(data);
}

export async function upsertVoice(voice: VoiceProfile): Promise<VoiceProfile> {
  const data = await ensure();
  const i = data.voices.findIndex((v) => v.id === voice.id);
  if (i >= 0) data.voices[i] = voice;
  else data.voices.unshift(voice);
  await writeStore(data);
  return voice;
}

export async function upsertHuman(human: LikenessClone): Promise<LikenessClone> {
  const data = await ensure();
  const i = data.humans.findIndex((h) => h.id === human.id);
  if (i >= 0) data.humans[i] = human;
  else data.humans.unshift(human);
  await writeStore(data);
  return human;
}

export async function addJob(job: Job): Promise<Job> {
  const data = await ensure();
  data.jobs.unshift(job);
  await writeStore(data);
  return job;
}

export async function patchJob(id: string, patch: Partial<Job>): Promise<Job | null> {
  const data = await ensure();
  const i = data.jobs.findIndex((j) => j.id === id);
  if (i < 0) return null;
  data.jobs[i] = { ...data.jobs[i], ...patch };
  await writeStore(data);
  return data.jobs[i];
}

export async function saveUpload(filename: string, buffer: Buffer): Promise<string> {
  await mkdir(UPLOADS, { recursive: true });
  const safe = `${Date.now()}-${nanoid(8)}-${filename.replace(/[^\w.\-]+/g, "_")}`;
  await writeFile(path.join(UPLOADS, safe), buffer);
  return `/api/files/${safe}`;
}

export function uploadPath(name: string): string {
  const base = path.basename(name);
  return path.join(UPLOADS, base);
}
