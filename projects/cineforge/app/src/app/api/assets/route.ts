import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { deleteAsset, readStore, upsertAsset } from "@/server/persist";
import type { Asset } from "@/lib/types";

export async function GET() {
  const data = await readStore();
  return NextResponse.json(data.assets);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Asset>;
  const now = new Date().toISOString();
  const asset: Asset = {
    id: body.id || `asset-${nanoid(8)}`,
    kind: body.kind || "character",
    name: body.name || "未命名",
    description: body.description || "",
    doNotTransfer: body.doNotTransfer || "",
    shots: body.shots || { wide: "", medium: "", close: "" },
    createdAt: body.createdAt || now,
  };
  await upsertAsset(asset);
  return NextResponse.json(asset);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await deleteAsset(id);
  return NextResponse.json({ ok: true });
}
