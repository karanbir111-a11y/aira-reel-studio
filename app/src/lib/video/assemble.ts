import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const TARGET_W = 1080;
const TARGET_H = 1920;
const FPS = 30;

// Music sits well under speech; loud enough to feel, quiet enough to ignore.
const MUSIC_GAIN = 0.11;

export interface SceneAsset {
  imagePath: string;
  durationSec: number;
}

function ffmpeg(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { cwd });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (e) => reject(new Error(`ffmpeg not runnable: ${e.message}`)));
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))
    );
  });
}

export function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path.resolve(filePath),
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => reject(new Error(`ffprobe not runnable: ${e.message}`)));
    proc.on("close", (code) => {
      const seconds = parseFloat(out.trim());
      if (code !== 0 || !Number.isFinite(seconds)) {
        reject(new Error(`ffprobe failed on ${filePath}: ${err.slice(-300)}`));
      } else {
        resolve(seconds);
      }
    });
  });
}

function secondsToAssTime(s: number): string {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const rem = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(rem).padStart(2, "0")}`;
}

function escapeAss(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

export interface CaptionChunk {
  text: string;
  start: number;
  end: number;
}

/**
 * Word-level ASR would be more accurate, but we already know exactly what was
 * spoken - only the timing is unknown. Distributing the script across the
 * measured audio by character weight lands close enough for short phrase
 * chunks, and costs nothing.
 */
export function buildCaptionChunks(
  script: string,
  audioSec: number,
  maxWords = 3,
  maxChars = 20
): CaptionChunk[] {
  const sentences = script
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  // Budget by characters as well as words: three long words overflow the
  // frame at this font size, where three short ones sit comfortably.
  const chunks: string[] = [];
  for (const sentence of sentences) {
    let current: string[] = [];
    for (const word of sentence.split(" ").filter(Boolean)) {
      const candidate = [...current, word];
      const width = candidate.join(" ").length;
      if (current.length && (candidate.length > maxWords || width > maxChars)) {
        chunks.push(current.join(" "));
        current = [word];
      } else {
        current = candidate;
      }
    }
    if (current.length) chunks.push(current.join(" "));
  }
  if (chunks.length === 0) return [];

  // Weight by character count so long chunks hold longer than short ones.
  const weights = chunks.map((c) => Math.max(1, c.replace(/\s/g, "").length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let cursor = 0;
  return chunks.map((text, i) => {
    const span = (weights[i] / totalWeight) * audioSec;
    const start = cursor;
    cursor += span;
    return { text, start, end: Math.min(cursor, audioSec) };
  });
}

function buildAss(chunks: CaptionChunk[]): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${TARGET_W}
PlayResY: ${TARGET_H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,Arial,84,&H00FFFFFF,&H00000000,&HB0000000,-1,0,0,0,100,100,0,0,1,8,3,2,80,80,340,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Quick scale-up then settle: reads as a "pop" without a library.
  const POP = "{\\fad(50,50)\\t(0,90,\\fscx112\\fscy112)\\t(90,170,\\fscx100\\fscy100)}";

  const lines = chunks.map(
    (c) =>
      `Dialogue: 0,${secondsToAssTime(c.start)},${secondsToAssTime(c.end)},Pop,,0,0,0,,${POP}${escapeAss(c.text)}`
  );

  return header + lines.join("\n") + "\n";
}

/** Writes subs.ass when there is a script, returning whether captions apply. */
function videoFilterFor(script?: string, audioPath?: string): boolean {
  return Boolean(script && !audioPath);
}

function kenBurnsFilter(durationSec: number): string {
  const frames = Math.max(1, Math.round(durationSec * FPS));
  return [
    `scale=${TARGET_W * 2}:${TARGET_H * 2}:force_original_aspect_ratio=increase`,
    `crop=${TARGET_W * 2}:${TARGET_H * 2}`,
    `zoompan=z='min(zoom+0.0015,1.4)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${TARGET_W}x${TARGET_H}:fps=${FPS}`,
    `setsar=1`,
  ].join(",");
}

export async function assembleReel(opts: {
  scenes: SceneAsset[];
  audioPath?: string;
  script?: string;
  musicPath?: string;
  outPath: string;
}): Promise<string> {
  const { scenes, audioPath, script, musicPath, outPath } = opts;
  if (scenes.length === 0) throw new Error("assembleReel: no scenes");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));

  try {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      await ffmpeg([
        "-y",
        "-loop", "1",
        "-i", path.resolve(scene.imagePath),
        "-vf", kenBurnsFilter(scene.durationSec),
        // Exact frame count, not -t: zoompan emits frames per input frame, so
        // an input-side duration limit lets the clip overrun.
        "-frames:v", String(Math.max(1, Math.round(scene.durationSec * FPS))),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
        `clip${i}.mp4`,
      ], work);
    }

    fs.writeFileSync(
      path.join(work, "list.txt"),
      scenes.map((_, i) => `file 'clip${i}.mp4'`).join("\n"),
      "utf-8"
    );
    await ffmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "silent.mp4"],
      work
    );

    // Run from the work dir so the subtitles filter gets a bare filename - a
    // Windows drive colon breaks filter parsing.
    let videoFilter = "";
    if (audioPath && script) {
      const audioSec = await probeDuration(audioPath);
      const chunks = buildCaptionChunks(script, audioSec);
      if (chunks.length) {
        fs.writeFileSync(path.join(work, "subs.ass"), buildAss(chunks), "utf-8");
        videoFilter = "subtitles=subs.ass";
      }
    }

    const args = ["-y", "-i", "silent.mp4"];
    if (audioPath) args.push("-i", path.resolve(audioPath));
    if (audioPath && musicPath) args.push("-stream_loop", "-1", "-i", path.resolve(musicPath));

    if (videoFilter) args.push("-vf", videoFilter);
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");

    if (audioPath && musicPath) {
      args.push(
        "-filter_complex",
        `[2:a]volume=${MUSIC_GAIN}[bed];[1:a][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[mix]`,
        "-map", "0:v:0",
        "-map", "[mix]",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest"
      );
    } else if (audioPath) {
      args.push("-c:a", "aac", "-b:a", "192k", "-map", "0:v:0", "-map", "1:a:0", "-shortest");
    }

    args.push("out.mp4");
    await ffmpeg(args, work);

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.copyFileSync(path.join(work, "out.mp4"), path.resolve(outPath));
    return path.resolve(outPath);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Stitch pre-rendered video clips (Veo output) into one reel, then lay a
 * continuous voiceover, music bed and synced captions over the whole thing.
 *
 * Each clip carries its own generated audio, which is deliberately dropped -
 * three independently generated beds do not join up into anything coherent.
 */
export async function assembleClips(opts: {
  clipPaths: string[];
  audioPath?: string;
  script?: string;
  musicPath?: string;
  /** True when the clips carry her generated speech and must keep their audio. */
  keepClipAudio?: boolean;
  outPath: string;
}): Promise<string> {
  const { clipPaths, audioPath, script, musicPath, keepClipAudio, outPath } = opts;
  if (clipPaths.length === 0) throw new Error("assembleClips: no clips");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));

  try {
    // Normalise each clip so concat demuxer gets a uniform stream, and strip
    // the generated audio in the same pass.
    for (let i = 0; i < clipPaths.length; i++) {
      await ffmpeg([
        "-y",
        "-i", path.resolve(clipPaths[i]),
        ...(keepClipAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
        "-vf", `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},fps=${FPS},setsar=1`,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        `norm${i}.mp4`,
      ], work);
    }

    fs.writeFileSync(
      path.join(work, "list.txt"),
      clipPaths.map((_, i) => `file 'norm${i}.mp4'`).join("\n"),
      "utf-8"
    );
    await ffmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "silent.mp4"],
      work
    );

    let videoFilter = "";
    // In speaking mode the voice is already inside the clips, so caption timing
    // comes from the concatenated video rather than a separate voiceover file.
    const captionSeconds =
      keepClipAudio && script
        ? await probeDuration(path.join(work, "silent.mp4"))
        : audioPath && script
          ? await probeDuration(audioPath)
          : 0;

    if (captionSeconds > 0 && script) {
      const chunks = buildCaptionChunks(script, captionSeconds);
      if (chunks.length) {
        fs.writeFileSync(path.join(work, "subs.ass"), buildAss(chunks), "utf-8");
        videoFilter = "subtitles=subs.ass";
      }
    }

    if (keepClipAudio) {
      const spoken = ["-y", "-i", "silent.mp4"];
      if (musicPath) spoken.push("-stream_loop", "-1", "-i", path.resolve(musicPath));
      if (videoFilter) spoken.push("-vf", videoFilter);
      spoken.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
      if (musicPath) {
        spoken.push(
          "-filter_complex",
          `[1:a]volume=${MUSIC_GAIN}[bed];[0:a][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[mix]`,
          "-map", "0:v:0", "-map", "[mix]", "-c:a", "aac", "-b:a", "192k", "-shortest"
        );
      } else {
        spoken.push("-c:a", "aac", "-b:a", "192k");
      }
      spoken.push("out.mp4");
      await ffmpeg(spoken, work);
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
      fs.copyFileSync(path.join(work, "out.mp4"), path.resolve(outPath));
      return path.resolve(outPath);
    }

    const args = ["-y", "-i", "silent.mp4"];
    if (audioPath) args.push("-i", path.resolve(audioPath));
    if (audioPath && musicPath) args.push("-stream_loop", "-1", "-i", path.resolve(musicPath));

    if (videoFilter) args.push("-vf", videoFilter);
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");

    if (audioPath && musicPath) {
      args.push(
        "-filter_complex",
        `[2:a]volume=${MUSIC_GAIN}[bed];[1:a][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[mix]`,
        "-map", "0:v:0",
        "-map", "[mix]",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest"
      );
    } else if (audioPath) {
      args.push("-c:a", "aac", "-b:a", "192k", "-map", "0:v:0", "-map", "1:a:0", "-shortest");
    }

    args.push("out.mp4");
    await ffmpeg(args, work);

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.copyFileSync(path.join(work, "out.mp4"), path.resolve(outPath));
    return path.resolve(outPath);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
