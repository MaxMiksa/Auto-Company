import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const LOCAL_FALLBACKS = [
  path.join(process.cwd(), "data", "waitlist.jsonl"),
  "/tmp/waitlist.jsonl",
];

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function appendToLocalFile(email: string) {
  const line =
    JSON.stringify({ email, createdAt: new Date().toISOString() }) + "\n";
  let lastError: unknown;

  for (const file of LOCAL_FALLBACKS) {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, line, "utf-8");
      return;
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError;
}

async function saveToPostgres(email: string) {
  const { createClient } = await import("@vercel/postgres");
  const client = createClient();

  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(
      "INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING;",
      [email]
    );
  } finally {
    await client.end().catch(() => {});
  }
}

function shouldUsePostgres() {
  return Boolean(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.DATABASE_URL
  );
}

async function saveWaitlist(email: string) {
  if (shouldUsePostgres()) {
    try {
      await saveToPostgres(email);
      return;
    } catch (error) {
      console.error("Postgres waitlist save failed, falling back to file:", error);
    }
  }

  await appendToLocalFile(email);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    await saveWaitlist(email);

    return NextResponse.json({ ok: true, email });
  } catch (error) {
    console.error("Waitlist POST error:", error);
    return NextResponse.json({ error: "Failed to save email" }, { status: 500 });
  }
}
