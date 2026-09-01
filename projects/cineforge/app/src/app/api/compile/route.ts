import { NextResponse } from "next/server";
import { compilePrompt } from "@/lib/llm";
import type { ProjectDraft } from "@/lib/types";
import { readStore } from "@/server/persist";

export async function POST(req: Request) {
  const draft = (await req.json()) as ProjectDraft;
  const data = await readStore();
  const compiled = await compilePrompt(draft, data.settings, data.assets, data.voices);
  return NextResponse.json(compiled);
}
