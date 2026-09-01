import { NextResponse } from "next/server";
import { patchSettings, readStore } from "@/server/persist";

export async function GET() {
  const data = await readStore();
  return NextResponse.json(data.settings);
}

export async function PUT(req: Request) {
  const body = await req.json();
  const settings = await patchSettings(body);
  return NextResponse.json(settings);
}
