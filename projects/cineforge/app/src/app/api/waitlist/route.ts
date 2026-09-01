import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const ROOT = path.join(process.cwd(), ".data");
const FILE = path.join(ROOT, "waitlist.json");

type WaitlistEntry = {
  id: string;
  name: string;
  email: string;
  intent: string;
  createdAt: string;
};

async function readList(): Promise<WaitlistEntry[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const data = JSON.parse(raw) as WaitlistEntry[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  let body: { name?: unknown; email?: unknown; intent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求体" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const intent = typeof body.intent === "string" ? body.intent.trim() : "";

  if (!name || name.length > 80) {
    return NextResponse.json({ error: "请填写姓名" }, { status: 400 });
  }
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "请填写有效邮箱" }, { status: 400 });
  }
  if (!intent || intent.length > 800) {
    return NextResponse.json({ error: "请填写意向" }, { status: 400 });
  }

  const entry: WaitlistEntry = {
    id: `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    email,
    intent,
    createdAt: new Date().toISOString(),
  };

  await mkdir(ROOT, { recursive: true });
  const list = await readList();
  list.unshift(entry);
  await writeFile(FILE, JSON.stringify(list, null, 2), "utf8");

  return NextResponse.json({ ok: true, id: entry.id });
}
