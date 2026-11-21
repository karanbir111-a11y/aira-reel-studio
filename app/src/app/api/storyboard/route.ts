import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { editImage, composeImage, generateSceneImage } from "@/lib/video/visuals";
import { personaReferences } from "@/lib/video/produce";
import { scrapeProducts, downloadProductImages, productsVisualBrief } from "@/lib/product";
import { readCharacter, characterVisualBlock, preservationBlock } from "@/lib/character";
import type { VideoConcept } from "@/lib/types";

export const maxDuration = 600;

function sse(controller: ReadableStreamDefaultController, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

/**
 * Generates one still per shot so each frame can be judged - and corrected -
 * at ~$0.04 before any $0.96 video call.
 *
 * Identity comes from the persona reference; product detail is reinforced in
 * the prompt text, because reference images alone reliably lose fine detail.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const concept: VideoConcept = body.concept;
  const productUrls: string[] = Array.isArray(body.productUrls)
    ? body.productUrls.map(String).map((u: string) => u.trim()).filter(Boolean)
    : [];
  const shotIndex: number | undefined =
    typeof body.shotIndex === "number" ? body.shotIndex : undefined;
  const overridePrompt: string | undefined = body.prompt;
  const draftId: string = body.draftId || uuid().slice(0, 8);

  const dir = path.join(process.cwd(), "public", "reels", draftId);

  const stream = new ReadableStream({
    async start(controller) {
      const step = (text: string) => sse(controller, { type: "step", text });

      try {
        if (!concept?.scenes?.length) throw new Error("No concept supplied");
        const character = readCharacter();
        fs.mkdirSync(dir, { recursive: true });

        const refs = personaReferences();
        if (refs.length === 0) throw new Error("No persona references in character/refs");
        const persona = refs[0];

        // Product shots are cropped to drop the stock model's head - two
        // competing faces makes the generator pick the wrong one.
        let garmentPath: string | undefined;
        let productText: string | undefined;
        if (productUrls.length) {
          step("Fetching product images");
          const products = await scrapeProducts(productUrls);
          if (products.length) {
            // Several products can be described in text, but only one can be
            // worn in the composite, so the first anchors the styling.
            const first = await downloadProductImages(products[0], path.join(dir, "product"), 1);
            garmentPath = first.imagePaths[0];
            productText = productsVisualBrief(products);
          }
        }

        const targets =
          shotIndex !== undefined
            ? [shotIndex]
            : concept.scenes.map((_, i) => i);

        const shots: { index: number; imageUrl: string; prompt: string }[] = [];

        const framing =
          "Vertical 9:16 portrait composition, photorealistic, cinematic lighting.";
        const locks = preservationBlock({ character, product: productText, target: "image" });
        const anchorPath = path.join(dir, "shot0.png");

        for (const i of targets) {
          const prompt = overridePrompt ?? concept.scenes[i].visualPrompt;
          const outPath = path.join(dir, `shot${i}.png`);
          step(`Generating still ${i + 1}`);

          // Shot 0 establishes the look. Every later shot is generated FROM it,
          // because "same room, same outfit" in text alone gets reinterpreted
          // freshly each time and silently invents a new room and new clothes.
          const anchored = i > 0 && fs.existsSync(anchorPath);

          if (anchored) {
            await composeImage(
              [anchorPath],
              `The attached image is the established look for this shoot: the same woman, ` +
                `the same location, the same outfit, the same lighting.\n\n` +
                `Produce the NEXT shot from the same shoot, matching it closely: the same ` +
                `styling, the same outfit and jewellery, the same room, furniture and ` +
                `lighting. Only her pose, action and the camera framing change.\n\n` +
                `New action: ${prompt}\n\n${framing}\n\n${locks}`,
              outPath
            );
          } else if (garmentPath) {
            await composeImage(
              [persona, garmentPath],
              `The first image is the model for this shoot. The second image shows the outfit ` +
                `she is styled in.\n\nProduce the resulting photograph: this same model, ` +
                `wearing that outfit, in the following scene.\n\nScene: ${prompt}\n\n` +
                `Reproduce the outfit's colours and detail exactly as in the second image. ` +
                `${framing}\n\n${locks}`,
              outPath
            );
          } else {
            await editImage(
              persona,
              `Generate a photograph of this woman.\n\nScene: ${prompt}\n\n${framing}\n\n${locks}`,
              outPath
            );
          }

          shots.push({ index: i, imageUrl: `/reels/${draftId}/shot${i}.png`, prompt });
        }

        sse(controller, { type: "done", draftId, shots });
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
