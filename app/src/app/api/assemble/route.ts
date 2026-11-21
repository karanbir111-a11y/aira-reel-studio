import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuid } from "uuid";
import { assembleClips, probeDuration } from "@/lib/video/assemble";
import { pickMusic } from "@/lib/video/produce";

export const maxDuration = 600;

const MAX_CLIP_BYTES = 200 * 1024 * 1024;

/**
 * Stitches clips rendered by hand in Google Flow into one reel.
 *
 * Flow has no API, so the clips come back as files the operator downloaded.
 * They already carry her speech, so their audio is kept and the music bed is
 * mixed underneath - the same path producePersonaReel takes, minus the part
 * we stopped paying for.
 */
export async function POST(request: Request) {
  let work: string | undefined;

  try {
    const form = await request.formData();
    const script = String(form.get("script") ?? "").trim();
    const musicMood = String(form.get("musicMood") ?? "").trim();
    const captions = String(form.get("captions") ?? "true") !== "false";
    const draftId = String(form.get("draftId") ?? "").trim();

    // Ordered by field name (clip0, clip1, ...) so shot order survives the
    // trip through FormData, which does not promise insertion order.
    const entries = [...form.entries()]
      .filter(([key, value]) => /^clip\d+$/.test(key) && value instanceof File)
      .sort(([a], [b]) => Number(a.slice(4)) - Number(b.slice(4)))
      .map(([, value]) => value as File);

    if (entries.length === 0) {
      return NextResponse.json({ error: "No clips uploaded" }, { status: 400 });
    }

    work = fs.mkdtempSync(path.join(os.tmpdir(), "flow-clips-"));
    const clipPaths: string[] = [];

    for (const [i, file] of entries.entries()) {
      if (file.size === 0) {
        return NextResponse.json(
          { error: `Clip ${i + 1} is empty` },
          { status: 400 }
        );
      }
      if (file.size > MAX_CLIP_BYTES) {
        return NextResponse.json(
          { error: `Clip ${i + 1} is larger than 200MB` },
          { status: 400 }
        );
      }
      const ext = path.extname(file.name).toLowerCase() || ".mp4";
      const dest = path.join(work, `in${i}${ext}`);
      fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
      clipPaths.push(dest);
    }

    const id = draftId || uuid().slice(0, 8);
    const outDir = path.join(process.cwd(), "public", "reels", id);
    const outPath = path.join(outDir, "reel.mp4");

    const musicPath = musicMood ? pickMusic(musicMood) : undefined;

    await assembleClips({
      clipPaths,
      script: captions ? script : undefined,
      musicPath,
      keepClipAudio: true,
      outPath,
    });

    const durationSec = await probeDuration(outPath);

    return NextResponse.json({
      id,
      videoUrl: `/reels/${id}/reel.mp4`,
      durationSec,
      clipCount: clipPaths.length,
      musicUsed: musicPath ? path.basename(musicPath) : "",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
  }
}
