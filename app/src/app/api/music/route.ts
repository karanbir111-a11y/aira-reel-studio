import { NextResponse } from "next/server";
import fs from "fs";
import { MUSIC_DIR } from "@/lib/video/produce";

export async function GET() {
  if (!fs.existsSync(MUSIC_DIR)) return NextResponse.json([]);
  const files = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f))
    .sort();
  return NextResponse.json(files);
}
