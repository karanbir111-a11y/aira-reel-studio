import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readReels, writeReels, upsertReel } from "@/lib/csv";
import type { Reel } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const reels = readReels();
  if (id) {
    const reel = reels.find((r) => r.id === id);
    if (!reel) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(reel);
  }
  return NextResponse.json(reels);
}

/** Text-only edits: caption, hashtags, title, status. No re-render. */
export async function PUT(request: Request) {
  const body = await request.json();
  const reels = readReels();
  const existing = reels.find((r) => r.id === body.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated: Reel = {
    ...existing,
    title: body.title ?? existing.title,
    caption: body.caption ?? existing.caption,
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : existing.hashtags,
    status: body.status ?? existing.status,
  };
  upsertReel(updated);
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const reels = readReels();
  writeReels(reels.filter((r) => r.id !== id));

  const dir = path.join(process.cwd(), "public", "reels", id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

  return NextResponse.json({ success: true });
}
