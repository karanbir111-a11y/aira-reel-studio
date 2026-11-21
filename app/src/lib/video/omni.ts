import fs from "fs";
import path from "path";

/**
 * Gemini Omni replaces Veo, which was shut down on 2026-10-22.
 *
 * It is a different API in every respect: a single synchronous POST to
 * /v1beta/interactions rather than a long-running predict-and-poll, snake_case
 * fields, and the finished mp4 returned inline as base64 instead of a URI.
 */
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const OMNI = "gemini-omni-1.1-flash";

/** Observed clip length. Omni has no documented duration parameter. */
export const CLIP_SECONDS = 10;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function imagePart(file: string) {
  return {
    type: "image",
    data: fs.readFileSync(path.resolve(file)).toString("base64"),
    mime_type: mimeFor(file),
  };
}

export interface ClipOptions {
  prompt: string;
  outPath: string;
  model?: string;
  /** Approved storyboard still, animated as the opening frame. */
  firstFramePath?: string;
  /** Where the clip should end up, for first/last interpolation. */
  lastFramePath?: string;
  /** Subject references, used when there is no first frame to animate. */
  referenceImagePaths?: string[];
  aspectRatio?: "9:16" | "16:9";
  resolution?: "360p" | "720p" | "1080p" | "4k";
  onProgress?: (step: string) => void;
}

export async function generateClip(opts: ClipOptions): Promise<string> {
  const {
    prompt,
    outPath,
    model = OMNI,
    firstFramePath,
    lastFramePath,
    referenceImagePaths = [],
    aspectRatio = "9:16",
    resolution = "720p",
    onProgress,
  } = opts;

  const key = getApiKey();
  const say = (s: string) => onProgress?.(s);

  const images: ReturnType<typeof imagePart>[] = [];
  let task: "text_to_video" | "image_to_video" | "reference_to_video" = "text_to_video";

  if (firstFramePath) {
    images.push(imagePart(firstFramePath));
    if (lastFramePath) images.push(imagePart(lastFramePath));
    task = "image_to_video";
  } else if (referenceImagePaths.length) {
    for (const file of referenceImagePaths) images.push(imagePart(file));
    task = "reference_to_video";
  }

  say(`generating with ${model} (${task}, ${resolution} ${aspectRatio})`);

  const res = await fetch(`${INTERACTIONS_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [...images, { type: "text", text: prompt }],
      response_format: { type: "video", aspect_ratio: aspectRatio, resolution },
      generation_config: { video_config: { task } },
    }),
  });

  if (!res.ok) {
    throw new Error(`Omni ${res.status}: ${(await res.text()).slice(0, 600)}`);
  }

  const json = await res.json();

  const video = (json.steps ?? [])
    .flatMap((step: { content?: { type: string; data?: string }[] }) => step.content ?? [])
    .find((c: { type: string; data?: string }) => c.type === "video" && c.data);

  if (!video?.data) {
    // A refused or filtered generation still returns 200, with the reason in
    // the step content rather than as an error.
    const text = (json.steps ?? [])
      .flatMap((step: { content?: { type: string; text?: string }[] }) => step.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text)
      .join(" ");
    throw new Error(
      `Omni returned no video. ${text || JSON.stringify(json).slice(0, 300)}\n\n` +
        `PROMPT SENT:\n${prompt.slice(0, 700)}`
    );
  }

  // Omni bills video output tokens, so report the real cost of each clip
  // rather than leaving it to a per-second estimate.
  const videoTokens = (json.usage?.output_tokens_by_modality ?? [])
    .filter((m: { modality: string }) => m.modality === "video")
    .reduce((n: number, m: { tokens: number }) => n + m.tokens, 0);
  if (videoTokens) {
    const dollars = ((videoTokens / 1e6) * 17.5).toFixed(2);
    say(`${videoTokens.toLocaleString()} video tokens = ~$${dollars}`);
  }

  say("downloading");
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), Buffer.from(video.data, "base64"));
  return path.resolve(outPath);
}
