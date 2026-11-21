import fs from "fs";
import path from "path";
import { readCharacter, characterVisualBlock, characterVoiceBlock, preservationBlock } from "./character";
import { redactTerms, personaReferences } from "./video/produce";
import { scrapeProducts, productsVisualBrief, redactionTerms } from "./product";
import { respellHinglish } from "./hinglish";
import type { FlowPackage, FlowShot, VideoConcept } from "./types";

export type { FlowPackage, FlowShot };

/*
 * Builds the copy-paste package for Google Flow.
 *
 * Flow has no API, so the pipeline stops at the brief. Each shot carries two
 * prompts: one to generate the still, one to animate it. Generating the still
 * inside Flow (or any chat tool the user already subscribes to) keeps this
 * step free - the storyboard here is optional, not a prerequisite.
 *
 * Flow is stateless between generations, so the character block repeats on
 * every shot; stating it once is exactly how the face drifts.
 */

/** The identity text to paste alongside the reference image, every time. */
export function characterPrompt(): string {
  const c = readCharacter();
  return [
    `CHARACTER REFERENCE (use the attached image as the exact likeness):`,
    characterVisualBlock(c),
    ``,
    `VOICE: ${characterVoiceBlock(c)}`,
    ``,
    `This is a fully AI-generated fictional character. No real person, celebrity or`,
    `public figure is depicted, referenced or named. Keep her face, hair, skin tone`,
    `and marks identical in every shot.`,
  ].join("\n");
}

export function buildFlowPackage(opts: {
  concept: VideoConcept;
  draftId?: string;
  characterImageUrl: string;
  product?: string;
  /** Local URLs of product reference photographs the operator will attach. */
  productImages?: string[];
  redact?: string[];
  reelsDir?: string;
}): FlowPackage {
  const {
    concept,
    draftId,
    characterImageUrl,
    product,
    productImages = [],
    redact = [],
    reelsDir,
  } = opts;
  const character = readCharacter();
  const speaking = concept.scenes.some((s) => (s.dialogue ?? "").trim());

  const removed = new Set<string>();
  // Keyed by original word so the same respelling across shots reports once.
  const respelled = new Map<string, string>();

  // The product description carries the brand name, and a brand named after a
  // person is what gets a generation refused. Describe the item, not the label.
  const safeProduct = product ? redactTerms(product, redact) : undefined;
  safeProduct?.removed.forEach((t) => removed.add(t));

  const videoLocks = preservationBlock({
    character,
    product: safeProduct?.text,
    productImages: productImages.length,
    speaking,
  });
  const imageLocks = preservationBlock({
    character,
    product: safeProduct?.text,
    productImages: productImages.length,
    target: "image",
  });

  let hasStoryboard = false;

  const shots: FlowShot[] = concept.scenes.map((scene, i) => {
    const visual = redactTerms(scene.visualPrompt, redact);
    const line = redactTerms((scene.dialogue ?? "").trim(), redact);
    [...visual.removed, ...line.removed].forEach((t) => removed.add(t));

    // The generator reads the dialogue with English letter rules, so a Hindi
    // word has to be spelled the way an English reader would have to spell it
    // to say it right. Dialogue only - the visual prompt is not spoken, and
    // the voiceover script becomes on-screen captions and stays readable.
    const spoken = respellHinglish(line.text);
    spoken.changes.forEach((c) => respelled.set(c.from, c.to));

    const stillPath =
      draftId && reelsDir ? path.join(reelsDir, draftId, `shot${i}.png`) : "";
    const stillExists = Boolean(stillPath && fs.existsSync(stillPath));
    if (stillExists) hasStoryboard = true;

    const alsoAttach = productImages.length
      ? ` Attach the product photograph${productImages.length > 1 ? "s" : ""} too.`
      : "";

    const continuity =
      i === 0
        ? `This is the establishing shot. It sets the location, lighting and her outfit for the whole reel.${alsoAttach}`
        : `Match shot 1 exactly: same location, same lighting, same outfit and jewellery. Only her pose and the framing change. Attach shot 1's image alongside the character reference.${alsoAttach}`;

    return {
      index: i,
      imageUrl: stillExists ? `/reels/${draftId}/shot${i}.png` : undefined,
      imagePrompt: [
        `STILL FOR SHOT ${i + 1} OF ${concept.scenes.length}`,
        visual.text,
        continuity,
        `Vertical 9:16 portrait composition, photorealistic, cinematic lighting.`,
        imageLocks,
      ]
        .filter(Boolean)
        .join("\n\n"),
      videoPrompt: [
        `SHOT ${i + 1} OF ${concept.scenes.length}`,
        visual.text,
        spoken.text ? `She looks at the camera and says: "${spoken.text}"` : "",
        videoLocks,
      ]
        .filter(Boolean)
        .join("\n\n"),
      dialogue: line.text,
    };
  });

  return {
    characterPrompt: characterPrompt(),
    characterImageUrl,
    productImageUrls: productImages,
    shots,
    caption: concept.caption,
    hashtags: concept.hashtags,
    removedTerms: [...removed],
    respellings: [...respelled].map(([from, to]) => ({ from, to })),
    hasStoryboard,
  };
}

/**
 * The whole hand-off: scrapes the products, mirrors the persona reference into
 * public/ so it can be downloaded, and builds the prompts.
 *
 * Shared by the flow route and the revise route. Rebuilding one shot's prompts
 * has to reproduce the others byte for byte - the continuity wording is what
 * stops the renderer inventing a new room - so both paths must go through one
 * function rather than two that agree today.
 */
export async function buildFlowPackageFor(opts: {
  concept: VideoConcept;
  draftId?: string;
  productUrls?: string[];
  productImages?: string[];
}): Promise<FlowPackage> {
  const { concept, draftId, productUrls = [], productImages = [] } = opts;

  let product: string | undefined;
  let redact: string[] = [];
  if (productUrls.length) {
    const products = await scrapeProducts(productUrls);
    if (products.length) {
      // The visual brief, not the full listing: the lock block repeats in
      // every shot prompt, and a spec sheet there drowns out the scene.
      product = productsVisualBrief(products);
      redact = redactionTerms(products);
    }
  }

  const refs = personaReferences();
  let characterImageUrl = "";
  if (refs[0]) {
    const previewDir = path.join(process.cwd(), "public", "character");
    fs.mkdirSync(previewDir, { recursive: true });
    const name = `ref0${path.extname(refs[0])}`;
    fs.copyFileSync(refs[0], path.join(previewDir, name));
    characterImageUrl = `/character/${name}`;
  }

  return buildFlowPackage({
    concept,
    draftId,
    characterImageUrl,
    product,
    productImages,
    redact,
    reelsDir: path.join(process.cwd(), "public", "reels"),
  });
}
