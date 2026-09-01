import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { uploadPath } from "@/server/persist";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  try {
    const buf = await readFile(uploadPath(name));
    const lower = name.toLowerCase();
    const type = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : lower.endsWith(".mp4")
          ? "video/mp4"
          : lower.endsWith(".wav")
            ? "audio/wav"
            : lower.endsWith(".mp3")
              ? "audio/mpeg"
              : "image/jpeg";
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": type } });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
