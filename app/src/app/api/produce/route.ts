import path from "path";
import { v4 as uuid } from "uuid";
import { produceReel, producePersonaReel } from "@/lib/video/produce";
import { upsertReel } from "@/lib/csv";
import { scrapeProduct } from "@/lib/product";
import type { ConceptGeneration, Reel } from "@/lib/types";

export const maxDuration = 900;

function sse(controller: ReadableStreamDefaultController, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(request: Request) {
  const body = await request.json();
  const generation: ConceptGeneration = body.generation;
  const conceptIndex: number = body.conceptIndex ?? 0;
  const renderMode: string = body.renderMode === "stills" ? "stills" : "persona";
  const configName: string = body.configName || "";
  const draftId: string | undefined = body.draftId;
  const override: boolean = Boolean(body.override);
  const redact: string[] = Array.isArray(body.redact) ? body.redact.map(String) : [];
  const productUrl: string = (body.productUrl || "").trim();

  // Written under public/ so the browser can play it back directly.
  // Reuse the storyboard draft folder so approved stills sit beside the clips.
  const id = draftId || uuid().slice(0, 8);
  const outDir = path.join(process.cwd(), "public", "reels", id);

  const stream = new ReadableStream({
    async start(controller) {
      const onProgress = (text: string) => sse(controller, { type: "step", text });

      try {
        if (!generation?.concepts?.length) throw new Error("No concepts supplied");

        // Deriving the terms server-side means redaction still happens even if
        // the browser never fetched the product preview.
        const terms = new Set(redact.filter(Boolean));
        if (productUrl) {
          try {
            const p = await scrapeProduct(productUrl);
            for (const word of [p.brand, ...p.brand.split(/\s+/)]) {
              if (word && word.length > 2) terms.add(word);
            }
          } catch {
            // preview failure must not stop a render
          }
        }

        const run = renderMode === "persona" ? producePersonaReel : produceReel;
        const concept0 = generation.concepts[conceptIndex];
        const storyboardPaths = concept0?.scenes.map((_, i) => path.join(outDir, `shot${i}.png`));
        const result = await run({ generation, conceptIndex, outDir, storyboardPaths, override, redact: [...terms], onProgress });

        if (result.status === "blocked") {
          sse(controller, { type: "blocked", reason: result.reason });
        } else {
          const concept = generation.concepts[conceptIndex];
          const reel: Reel = {
            id,
            title: concept.title,
            hook: concept.hook,
            caption: result.caption ?? concept.caption,
            hashtags: result.hashtags ?? concept.hashtags,
            voiceoverScript: concept.voiceoverScript,
            scenes: concept.scenes,
            clips: concept.scenes.map((_, i) => `clip${i}.mp4`),
            videoUrl: `/reels/${id}/reel.mp4`,
            durationSec: result.durationSec ?? 0,
            configName,
            renderMode,
            musicUsed: result.musicUsed ?? "",
            status: "draft",
            createdAt: new Date().toISOString(),
          };
          upsertReel(reel);

          sse(controller, {
            type: "done",
            id,
            videoUrl: `/reels/${id}/reel.mp4`,
            caption: result.caption,
            hashtags: result.hashtags,
            durationSec: result.durationSec,
            musicUsed: result.musicUsed,
          });
        }
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
