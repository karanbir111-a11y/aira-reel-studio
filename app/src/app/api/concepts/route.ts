import { readConfigs } from "@/lib/csv";
import { generateConcepts, type RenderMode } from "@/lib/claude";
import { scrapeReels } from "@/lib/apify";
import { uploadVideo, analyzeVideo } from "@/lib/gemini";
import { readBrand, brandBlock } from "@/lib/brand";
import { scrapeProducts, productsBrief } from "@/lib/product";

export const maxDuration = 900;

/**
 * Used when no client brief is selected. A config normally supplies its own
 * analysis instruction; without one, Gemini still needs to be told what to
 * look for, and "describe the video" produces a summary rather than the
 * structural read the concept writer needs.
 */
const DEFAULT_ANALYSIS_INSTRUCTION = `Analyse this Instagram Reel as a piece of craft, so that its
structure can be reused for a different brand.

Cover, in order:
- The hook: the literal first 1-2 seconds, what is said and what is shown.
- The structure: each beat in order, with roughly how long it holds.
- The retention mechanics: what makes a viewer stay past each beat.
- The shooting style: framing, camera movement, lighting, location, pacing, editing rhythm.
- The audio: whether someone speaks to camera, voiceover, or music only, and the tone.
- The call to action, and where it lands.

Describe what is actually there. Do not speculate about performance figures, and do not
recommend changes - this is a read of the reference, not a critique.`;

function sse(controller: ReadableStreamDefaultController, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

/** Accepts a bare handle, @handle, or a full instagram.com/p/... reel URL. */
function parseReference(raw: string): { kind: "reel"; url: string } | { kind: "user"; handle: string } {
  const value = raw.trim();
  if (/instagram\.com\/(p|reel|reels)\//i.test(value)) return { kind: "reel", url: value };
  const handle = value
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");
  return { kind: "user", handle };
}

export async function POST(request: Request) {
  const body = await request.json();
  const renderMode: RenderMode = body.renderMode === "stills" ? "stills" : "persona";
  const configName: string = body.configName;
  const references: string[] = Array.isArray(body.references)
    ? body.references.map(String).filter((r: string) => r.trim())
    : [];
  const directPrompt: string = (body.prompt || "").trim();
  const productUrls: string[] = Array.isArray(body.productUrls)
    ? body.productUrls.map(String).map((u: string) => u.trim()).filter(Boolean)
    : [];
  const productImages: string[] = Array.isArray(body.productImages)
    ? body.productImages.map(String).filter(Boolean)
    : [];
  const targetSeconds: number = Number(body.targetSeconds) || 24;
  const speaking: boolean = Boolean(body.speaking);

  const stream = new ReadableStream({
    async start(controller) {
      const step = (text: string) => sse(controller, { type: "step", text });

      try {
        // The brief is optional. A named one that cannot be found is still an
        // error though - silently running without it would hand back concepts
        // for the wrong client.
        const config = configName
          ? readConfigs().find((c) => c.configName === configName)
          : undefined;
        if (configName && !config) throw new Error(`Config not found: ${configName}`);

        if (
          references.length === 0 &&
          !directPrompt &&
          productUrls.length === 0 &&
          productImages.length === 0
        ) {
          throw new Error("Add a reference, a direction, or a product");
        }

        let product: string | undefined;
        if (productUrls.length) {
          step(`Reading ${productUrls.length} product page${productUrls.length > 1 ? "s" : ""}`);
          const products = await scrapeProducts(productUrls);
          if (products.length) {
            product = productsBrief(products);
            sse(controller, { type: "products", products });
          }
        }

        // Each reference costs a scrape plus a Gemini video analysis, so they
        // are analysed in sequence with progress rather than silently batched.
        const analyses: string[] = [];
        for (const raw of references) {
          const ref = parseReference(raw);
          let videoUrl = "";
          let label = "";

          if (ref.kind === "user") {
            step(`Scraping @${ref.handle}`);
            const reels = await scrapeReels(ref.handle, 10, 60);
            const usable = reels
              .filter((r) => r.videoUrl && r.timestamp)
              .sort((a, b) => (b.videoPlayCount || 0) - (a.videoPlayCount || 0));
            if (usable.length === 0) throw new Error(`No reels found for @${ref.handle}`);
            videoUrl = usable[0].videoUrl;
            label = `@${ref.handle} (${(usable[0].videoPlayCount || 0).toLocaleString()} views)`;
          } else {
            step(`Fetching reel ${ref.url}`);
            const reels = await scrapeReels(ref.url, 1, 3650);
            const usable = reels.filter((r) => r.videoUrl);
            if (usable.length === 0) throw new Error(`Could not read that reel URL`);
            videoUrl = usable[0].videoUrl;
            label = ref.url;
          }

          step(`Downloading ${label}`);
          const res = await fetch(videoUrl);
          if (!res.ok) throw new Error(`Video download failed (${res.status})`);
          const buf = Buffer.from(await res.arrayBuffer());

          step("Uploading to Gemini");
          const file = await uploadVideo(buf, res.headers.get("content-type") || "video/mp4");

          step(`Analysing ${label}`);
          analyses.push(
            await analyzeVideo(
              file.uri,
              file.mimeType,
              config?.analysisInstruction || DEFAULT_ANALYSIS_INSTRUCTION
            )
          );
        }

        const referenceAnalysis = analyses.length
          ? analyses
              .map((a, i) => (analyses.length > 1 ? `## Reference ${i + 1}\n\n${a}` : a))
              .join("\n\n---\n\n")
          : undefined;

        step("Generating concepts");
        const generation = await generateConcepts({
          brief: config?.newConceptsInstruction,
          referenceAnalysis,
          directPrompt: directPrompt || undefined,
          globalBrand: brandBlock(readBrand()) || undefined,
          product,
          productImageCount: productImages.length,
          renderMode,
          targetSeconds,
          speaking,
        });

        sse(controller, { type: "done", generation, renderMode, configName, productUrls });
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
