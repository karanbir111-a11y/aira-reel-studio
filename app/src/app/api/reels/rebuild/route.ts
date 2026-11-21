import fs from "fs";
import path from "path";
import { readReels, upsertReel } from "@/lib/csv";
import { assembleClips } from "@/lib/video/assemble";
import { synthesizeVoiceover } from "@/lib/video/tts";
import { generateClip } from "@/lib/video/omni";
import { pickMusic, MUSIC_DIR, personaReferences } from "@/lib/video/produce";
import { readCharacter, preservationBlock } from "@/lib/character";

export const maxDuration = 900;

function sse(controller: ReadableStreamDefaultController, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

/**
 * Rebuilds an existing reel from the clips already on disk.
 *
 * Everything here is free except `rerollIndex`, which spends one Veo call to
 * regenerate a single shot. That split is the whole point of keeping clips
 * separate: fixing one bad shot costs ~$0.96, not a full re-render.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const id: string = body.id;
  const rerollIndex: number | undefined =
    typeof body.rerollIndex === "number" ? body.rerollIndex : undefined;
  const newPrompt: string | undefined = body.prompt;
  const musicFile: string | undefined = body.musicFile;
  const newScript: string | undefined = body.voiceoverScript;

  const stream = new ReadableStream({
    async start(controller) {
      const step = (text: string) => sse(controller, { type: "step", text });

      try {
        const reel = readReels().find((r) => r.id === id);
        if (!reel) throw new Error("Reel not found");

        const dir = path.join(process.cwd(), "public", "reels", id);
        if (!fs.existsSync(dir)) throw new Error("Reel files are missing from disk");

        const scenes = [...reel.scenes];
        let script = reel.voiceoverScript;
        let audioPath = path.join(dir, "voice.wav");

        if (rerollIndex !== undefined) {
          const refs = personaReferences();
          if (refs.length === 0) throw new Error("No persona references found");
          const prompt = newPrompt ?? scenes[rerollIndex]?.visualPrompt;
          if (!prompt) throw new Error(`No prompt for shot ${rerollIndex + 1}`);

          step(`Re-rolling shot ${rerollIndex + 1} (1-3 min, ~$0.96)`);
          await generateClip({
            prompt: `${prompt}

${preservationBlock({ character: readCharacter() })}`,
            referenceImagePaths: refs,
            aspectRatio: "9:16",
            resolution: "1080p",
            outPath: path.join(dir, reel.clips[rerollIndex]),
            onProgress: (s) => step(`shot ${rerollIndex + 1}: ${s}`),
          });
          scenes[rerollIndex] = { ...scenes[rerollIndex], visualPrompt: prompt };
        }

        if (newScript && newScript.trim() && newScript !== reel.voiceoverScript) {
          step("Re-recording voiceover");
          script = newScript.trim();
          fs.writeFileSync(audioPath, await synthesizeVoiceover(script));
        }
        if (!fs.existsSync(audioPath)) audioPath = "";

        const musicPath = musicFile
          ? path.join(MUSIC_DIR, musicFile)
          : pickMusic(reel.musicUsed || "");

        step("Re-assembling");
        await assembleClips({
          clipPaths: reel.clips.map((c) => path.join(dir, c)),
          audioPath: audioPath || undefined,
          script,
          musicPath: musicPath && fs.existsSync(musicPath) ? musicPath : undefined,
          outPath: path.join(dir, "reel.mp4"),
        });

        const updated = {
          ...reel,
          scenes,
          voiceoverScript: script,
          musicUsed: musicPath ? path.basename(musicPath) : "",
        };
        upsertReel(updated);

        step("done");
        // Cache-bust so the browser reloads the replaced file.
        sse(controller, { type: "done", reel: updated, cacheBust: Date.now() });
      } catch (err) {
        sse(controller, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
