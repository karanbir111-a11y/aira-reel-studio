import fs from "fs";
import path from "path";
import { assembleReel, assembleClips, probeDuration, type SceneAsset } from "./assemble";
import { synthesizeVoiceover } from "./tts";
import { generateSceneImage } from "./visuals";
import { generateClip, CLIP_SECONDS } from "./omni";
import { readCharacter, preservationBlock } from "../character";
import type { ConceptGeneration, VideoConcept } from "../types";

export interface ProduceResult {
  status: "produced" | "blocked";
  reason?: string;
  videoPath?: string;
  caption?: string;
  hashtags?: string[];
  durationSec?: number;
  musicUsed?: string;
}

/**
 * The spend gate. Nothing downstream of this costs money, so every reason to
 * decline has to be caught here.
 */
export function gateCheck(gen: ConceptGeneration): { pass: boolean; reason?: string } {
  if (!gen.productionRecommended) {
    return { pass: false, reason: gen.blockers.join("; ") || "productionRecommended was false" };
  }
  if (gen.sufficiency === "insufficient") {
    return { pass: false, reason: "reference analysis was insufficient" };
  }
  if (gen.confidence === "low") {
    return { pass: false, reason: "confidence was low" };
  }
  if (gen.concepts.length === 0) {
    return { pass: false, reason: "no concepts returned" };
  }
  return { pass: true };
}

/**
 * Claude estimates scene durations while writing, but the generated voiceover is
 * the real clock. Scale the scenes to match it so audio is never truncated and
 * the last scene never hangs on silence.
 */
export function fitScenesToAudio(scenes: VideoConcept["scenes"], audioSec: number) {
  const planned = scenes.reduce((sum, s) => sum + s.durationSec, 0);
  if (planned <= 0) {
    const even = audioSec / scenes.length;
    return scenes.map((s) => ({ ...s, durationSec: even }));
  }
  const scale = audioSec / planned;
  return scenes.map((s) => ({ ...s, durationSec: Math.max(0.8, s.durationSec * scale) }));
}

export const MUSIC_DIR = path.resolve(process.cwd(), "..", "music");

/**
 * Drop tracks into /music. A filename matching a word from the concept's
 * musicMood wins; otherwise any track beats silence.
 */
export function pickMusic(mood: string, dir = MUSIC_DIR): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f));
  if (files.length === 0) return undefined;

  const words = mood.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const match = files.find((f) => words.some((w) => f.toLowerCase().includes(w)));
  return path.join(dir, match ?? files[Math.floor(Math.random() * files.length)]);
}

export async function produceReel(opts: {
  generation: ConceptGeneration;
  conceptIndex: number;
  outDir: string;
  override?: boolean;
  onProgress?: (step: string) => void;
}): Promise<ProduceResult> {
  const { generation, conceptIndex, outDir, override, onProgress } = opts;
  const say = (s: string) => onProgress?.(s);

  // The gate stops spending by default; the operator can override it after
  // reading the blockers, which the UI requires before enabling this.
  const gate = override ? { pass: true } : gateCheck(generation);
  if (!gate.pass) {
    say(`blocked: ${"reason" in gate ? gate.reason : ""}`);
    return { status: "blocked", reason: "reason" in gate ? gate.reason : undefined };
  }

  const concept = generation.concepts[conceptIndex];
  if (!concept) return { status: "blocked", reason: `no concept at index ${conceptIndex}` };

  const workDir = path.resolve(outDir);
  fs.mkdirSync(workDir, { recursive: true });

  say("synthesising voiceover");
  const wav = await synthesizeVoiceover(concept.voiceoverScript);
  const audioPath = path.join(workDir, "voice.wav");
  fs.writeFileSync(audioPath, wav);

  const audioSec = await probeDuration(audioPath);
  say(`voiceover ${audioSec.toFixed(2)}s`);

  const fitted = fitScenesToAudio(concept.scenes, audioSec);

  say(`generating ${fitted.length} scene images`);
  const assets: SceneAsset[] = [];
  for (let i = 0; i < fitted.length; i++) {
    const imagePath = path.join(workDir, `scene${i}.png`);
    await generateSceneImage(fitted[i].visualPrompt, imagePath);
    say(`image ${i + 1}/${fitted.length}`);
    assets.push({ imagePath, durationSec: fitted[i].durationSec });
  }

  const musicPath = pickMusic(concept.musicMood);
  say(musicPath ? `music: ${path.basename(musicPath)}` : "no music (drop tracks in /music)");

  say("assembling");
  const videoPath = await assembleReel({
    scenes: assets,
    audioPath,
    script: concept.voiceoverScript,
    musicPath,
    outPath: path.join(workDir, "reel.mp4"),
  });

  fs.writeFileSync(
    path.join(workDir, "post.json"),
    JSON.stringify(
      {
        title: concept.title,
        caption: concept.caption,
        hashtags: concept.hashtags,
        musicMood: concept.musicMood,
        musicUsed: musicPath ? path.basename(musicPath) : null,
        promptVersion: generation.promptVersion,
        confidence: generation.confidence,
      },
      null,
      2
    ),
    "utf-8"
  );

  say("done");
  return {
    status: "produced",
    videoPath,
    caption: concept.caption,
    hashtags: concept.hashtags,
    durationSec: audioSec,
    musicUsed: musicPath ? path.basename(musicPath) : undefined,
  };
}

/**
 * Veo refuses prompts containing real people's names, and fashion brands are
 * routinely named after their founder. Strip those terms before rendering -
 * the brand belongs in the caption, not inside the frame.
 */
export function redactTerms(text: string, terms: string[]): { text: string; removed: string[] } {
  let out = text;
  const removed: string[] = [];

  for (const raw of terms) {
    const term = raw.trim();
    if (term.length < 3) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "gi");
    if (pattern.test(out)) {
      removed.push(term);
      out = out.replace(pattern, " ");
    }
  }

  const tidy = out
    // Redacting a value can leave its label stranded ("Brand:" with nothing
    // after it, which then ran into the next field). Drop any line that is
    // now just a label. Scoped to the labels productBrief emits so a scene
    // line that happens to end in a colon survives.
    .replace(/^[ \t]*(?:Product|Brand|Price|Colour|Details|Description):[ \t]*$\n?/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text: tidy, removed };
}

export const PERSONA_DIR = path.resolve(process.cwd(), "..", "character", "refs");

/**
 * The persona's reference images. Veo caps at 3, and every slot spent pinning
 * her is a slot unavailable for a product later, so only the first three are
 * taken.
 *
 * Plain ref0, ref1, ref2 only. There used to be a preference for a parallel
 * "_mole" set carrying a chin beauty mark; the mark is gone from the persona,
 * and the preference would have quietly reinstated it from any such file left
 * in the folder, which is exactly the kind of drift the lock exists to stop.
 */
export function personaReferences(dir = PERSONA_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^ref\d+\.(png|jpg|jpeg)$/i.test(f))
    .sort()
    .slice(0, 3)
    .map((f) => path.join(dir, f));
}



export async function producePersonaReel(opts: {
  generation: ConceptGeneration;
  conceptIndex: number;
  outDir: string;
  resolution?: "720p" | "1080p";
  /** Approved storyboard stills, one per shot, used as each clip's opening frame. */
  storyboardPaths?: string[];
  override?: boolean;
  /** Brand or person names that must not reach the video generator. */
  redact?: string[];
  onProgress?: (step: string) => void;
}): Promise<ProduceResult> {
  const { generation, conceptIndex, outDir, resolution = "1080p", storyboardPaths, override, redact = [], onProgress } = opts;
  // Claude lists the names tied to the brief; combined with the scraped brand
  // this covers products whose page gave us no usable brand field.
  const redactAll = [...new Set([...redact, ...(generation.brandTerms ?? [])])].filter(Boolean);
  const say = (s: string) => onProgress?.(s);

  // The gate stops spending by default; the operator can override it after
  // reading the blockers, which the UI requires before enabling this.
  const gate = override ? { pass: true } : gateCheck(generation);
  if (!gate.pass) {
    say(`blocked: ${"reason" in gate ? gate.reason : ""}`);
    return { status: "blocked", reason: "reason" in gate ? gate.reason : undefined };
  }

  const concept = generation.concepts[conceptIndex];
  if (!concept) return { status: "blocked", reason: `no concept at index ${conceptIndex}` };

  const character = readCharacter();
  // When any shot has dialogue she talks on camera: Veo generates her voice,
  // so no TTS track is made and the clips keep their own audio.
  const speaking = concept.scenes.some((s) => (s.dialogue ?? "").trim());
  const locks = preservationBlock({ character, speaking });

  const refs = personaReferences();
  if (refs.length === 0) {
    return { status: "blocked", reason: "no persona reference images in character/refs" };
  }

  const workDir = path.resolve(outDir);
  fs.mkdirSync(workDir, { recursive: true });

  let audioPath: string | undefined;
  let audioSec = concept.scenes.length * CLIP_SECONDS;

  if (speaking) {
    say("she speaks on camera - Veo will generate her voice");
  } else {
    say("synthesising voiceover");
    const wav = await synthesizeVoiceover(concept.voiceoverScript);
    audioPath = path.join(workDir, "voice.wav");
    fs.writeFileSync(audioPath, wav);
    audioSec = await probeDuration(audioPath);
    say(`voiceover ${audioSec.toFixed(2)}s`);
  }

  // Each scene is one 8s Veo generation. Veo's own audio is discarded - three
  // independent clips produce three unrelated beds, so we lay our own
  // continuous voiceover and music over the stitched video instead.
  const clipPaths: string[] = [];
  for (let i = 0; i < concept.scenes.length; i++) {
    say(`generating clip ${i + 1}/${concept.scenes.length} (1-3 min)`);
    const clipPath = path.join(workDir, `clip${i}.mp4`);
    // An approved still already carries the persona and any product detail, so
    // it supersedes reference images - animating a frame preserves far more
    // than rebuilding the scene from references.
    const scene = concept.scenes[i];
    const spoken = (scene.dialogue ?? "").trim();
    const visual = redactTerms(scene.visualPrompt, redactAll);
    const line = redactTerms(spoken, redactAll);
    const dropped = [...new Set([...visual.removed, ...line.removed])];
    if (dropped.length) say(`removed from prompt (Veo rejects real names): ${dropped.join(", ")}`);

    const firstFrame = storyboardPaths?.[i];
    await generateClip({
      prompt: [
        visual.text,
        line.text ? `She looks at the camera and says: "${line.text}"` : "",
        locks,
      ]
        .filter(Boolean)
        .join("\n\n"),
      ...(firstFrame && fs.existsSync(firstFrame)
        ? { firstFramePath: firstFrame }
        : { referenceImagePaths: refs }),
      aspectRatio: "9:16",
      resolution,
      outPath: clipPath,
      onProgress: (s) => say(`clip ${i + 1}: ${s}`),
    });
    clipPaths.push(clipPath);
  }

  const musicPath = pickMusic(concept.musicMood);
  say(musicPath ? `music: ${path.basename(musicPath)}` : "no music (drop tracks in /music)");

  say("assembling");
  const videoPath = await assembleClips({
    clipPaths,
    audioPath,
    script: concept.voiceoverScript,
    musicPath,
    keepClipAudio: speaking,
    outPath: path.join(workDir, "reel.mp4"),
  });

  fs.writeFileSync(
    path.join(workDir, "post.json"),
    JSON.stringify(
      {
        title: concept.title,
        hook: concept.hook,
        caption: concept.caption,
        hashtags: concept.hashtags,
        musicMood: concept.musicMood,
        musicUsed: musicPath ? path.basename(musicPath) : null,
        promptVersion: generation.promptVersion,
        confidence: generation.confidence,
        mode: "persona",
        voiceoverScript: concept.voiceoverScript,
        scenes: concept.scenes,
        clips: clipPaths.map((c) => path.basename(c)),
      },
      null,
      2
    ),
    "utf-8"
  );

  say("done");
  return {
    status: "produced",
    videoPath,
    caption: concept.caption,
    hashtags: concept.hashtags,
    durationSec: audioSec,
    musicUsed: musicPath ? path.basename(musicPath) : undefined,
  };
}
