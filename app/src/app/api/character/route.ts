import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readCharacter, writeCharacter, DEFAULT_CHARACTER } from "@/lib/character";
import { personaReferences } from "@/lib/video/produce";

export async function GET() {
  // Reference images live outside public/, so copy them in for preview only.
  const previewDir = path.join(process.cwd(), "public", "character");
  fs.mkdirSync(previewDir, { recursive: true });

  const refs = personaReferences().map((src, i) => {
    const name = `ref${i}${path.extname(src)}`;
    try {
      fs.copyFileSync(src, path.join(previewDir, name));
      return `/character/${name}`;
    } catch {
      return "";
    }
  });

  return NextResponse.json({ ...readCharacter(), referenceImages: refs.filter(Boolean) });
}

export async function PUT(request: Request) {
  const body = await request.json();
  return NextResponse.json(
    writeCharacter({
      ...DEFAULT_CHARACTER,
      name: body.name ?? DEFAULT_CHARACTER.name,
      appearance: body.appearance ?? "",
      distinguishingMarks: body.distinguishingMarks ?? "",
      voice: body.voice ?? "",
      speakingStyle: body.speakingStyle ?? "",
      updatedAt: "",
    })
  );
}
