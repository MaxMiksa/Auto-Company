import { NextResponse } from "next/server";
import { saveUpload } from "@/server/persist";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const url = await saveUpload(file.name, buf);
  return NextResponse.json({ url, name: file.name, size: file.size });
}
