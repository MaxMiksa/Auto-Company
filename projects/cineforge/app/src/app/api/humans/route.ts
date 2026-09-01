import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { readStore, upsertHuman } from "@/server/persist";
import type { LikenessClone } from "@/lib/types";

export async function GET() {
  const data = await readStore();
  return NextResponse.json(data.humans);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<LikenessClone>;
  const human: LikenessClone = {
    id: body.id || `human-${nanoid(8)}`,
    name: body.name || "未命名克隆",
    consent: body.consent || "",
    characterId: body.characterId || "",
    defaultVoiceId: body.defaultVoiceId || "",
    notes: body.notes || "",
    createdAt: body.createdAt || new Date().toISOString(),
    cloneStatus: body.cloneStatus || "queued",
  };
  await upsertHuman(human);
  return NextResponse.json(human);
}
