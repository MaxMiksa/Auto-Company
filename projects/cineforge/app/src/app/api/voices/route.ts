import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { readStore, upsertVoice } from "@/server/persist";
import type { VoiceProfile } from "@/lib/types";

export async function GET() {
  const data = await readStore();
  return NextResponse.json(data.voices);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<VoiceProfile>;
  const voice: VoiceProfile = {
    id: body.id || `voice-${nanoid(8)}`,
    name: body.name || "未命名音色",
    description: body.description || "",
    sampleUrl: body.sampleUrl || "",
    useFor: body.useFor || "dialogue",
    createdAt: body.createdAt || new Date().toISOString(),
    cloneStatus: body.cloneStatus || "ready",
  };
  await upsertVoice(voice);
  return NextResponse.json(voice);
}
