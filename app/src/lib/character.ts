import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "..", "data", "character.json");

/**
 * The persona's fixed identity. Nothing here is generated per reel - it is
 * written once and injected into every image and video prompt, because
 * generators drift the moment a trait is left unstated.
 */
export interface CharacterIdentity {
  name: string;
  /** Face, hair, skin, build. Stated the same way every time. */
  appearance: string;
  /** Marks that reference images reliably lose - say them explicitly. */
  distinguishingMarks: string;
  /** Timbre, pitch, accent. Only pace and expressiveness may vary. */
  voice: string;
  /** How she talks: language mix, rhythm, register. */
  speakingStyle: string;
  updatedAt: string;
}

export const DEFAULT_CHARACTER: CharacterIdentity = {
  name: "Aira",
  appearance:
    "A young Indian woman in her mid-twenties with long straight dark brown hair, " +
    "warm medium skin tone, dark brown eyes, softly defined features and a slim build.",
  // Empty on purpose. She had a chin beauty mark; it was removed from her
  // reference image too, so naming one here would ask the renderer to invent
  // a mark the likeness does not have.
  distinguishingMarks: "",
  voice:
    "Warm, bright young female voice with a natural Indian English accent, " +
    "medium pitch, clear pronunciation, unforced and conversational.",
  speakingStyle:
    "Speaks natural Hinglish, switching easily between Hindi and English. " +
    "Sounds like a friend talking to camera, not a voice-over. Lively pitch " +
    "variation, genuine enthusiasm, natural pauses. Never flat, never salesy.",
  updatedAt: "",
};

export function readCharacter(): CharacterIdentity {
  try {
    return { ...DEFAULT_CHARACTER, ...JSON.parse(fs.readFileSync(FILE, "utf-8")) };
  } catch {
    return DEFAULT_CHARACTER;
  }
}

export function writeCharacter(identity: CharacterIdentity): CharacterIdentity {
  const next = { ...identity, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** Visual identity, for image and video prompts. */
export function characterVisualBlock(c: CharacterIdentity): string {
  return `${c.appearance} ${c.distinguishingMarks}`.trim();
}

/** Voice identity, for video prompts only. */
export function characterVoiceBlock(c: CharacterIdentity): string {
  return `${c.voice} ${c.speakingStyle}`.trim();
}

/**
 * Appended to every generated prompt.
 *
 * Generators drift unless told repeatedly and explicitly what must not change,
 * so this restates the locks and ends with an priority order to resolve
 * conflicts between them.
 */
export function preservationBlock(opts: {
  character: CharacterIdentity;
  product?: string;
  /**
   * How many product reference photographs the operator will attach. A listing
   * never describes every detail of a garment, so when photographs are there
   * they are named as the authority and the written spec is demoted to a
   * reading aid - otherwise the renderer invents the parts the words missed.
   */
  productImages?: number;
  speaking?: boolean;
  /**
   * Image generation refuses prompts that read as face preservation or face
   * swapping, so the still path gets continuity-of-styling wording instead of
   * the identity-lock wording the video model needs.
   */
  target?: "video" | "image";
}): string {
  const { character, product, productImages = 0, speaking, target = "video" } = opts;

  const parts: string[] = [
    `SYNTHETIC CONTENT DECLARATION. This is a fully AI-generated fictional character ` +
      `created for this production. No real person, celebrity, public figure, influencer ` +
      `or existing model is depicted, referenced, named or impersonated anywhere in this ` +
      `shot. Any brand or product shown is referred to generically. There is no real ` +
      `individual's likeness or name in this prompt.`,
    target === "image"
      ? `CONTINUITY. The attached photograph shows the styled look for this shoot. ` +
        `Every frame features that same look: ` +
        `${characterVisualBlock(character)} Keep that look consistent.`
      : `CHARACTER IDENTITY LOCK. Use the attached reference image as her exact likeness. ` +
        `Preserve her exact facial identity, skin tone, facial ` +
        `proportions and hair throughout: ${characterVisualBlock(character)} ` +
        `Do not alter her face, age or build. Do not substitute a different person.`,
  ];

  // Photographs alone are enough to lock a product: a page that would not
  // scrape, or an item with no page at all, still has to come out right.
  if (product || productImages > 0) {
    const one = productImages === 1;
    const photos = one ? "photograph" : "photographs";
    const show = one ? "shows" : "show";

    const source =
      productImages > 0
        ? `The attached product ${photos} ${show} the exact item. ` +
          `Copy it from ${one ? "that photograph" : "those photographs"}: its neckline, ` +
          `sleeves, hemline, cut, print placement, embroidery, trims and colour are ` +
          `whatever the ${photos} ${show}, not whatever is usual for the garment.` +
          (product
            ? ` Where the ${photos} and this description disagree, the ${photos} win. ` +
              `In words it is: ${product}`
            : "")
        : `The product is: ${product}`;

    parts.push(
      `PRODUCT APPEARANCE LOCK. ${source} ` +
        `Reproduce it exactly as supplied. Preserve its exact colours, materials, pattern, ` +
        `geometry, proportions, lettering and branding. Do not redesign it, do not substitute ` +
        `a similar-looking item, do not invent logos or alter text. It may move naturally, but ` +
        `must not morph, stretch, duplicate or change design between frames.`
    );
  }

  if (speaking) {
    parts.push(
      `VOICE IDENTITY LOCK. ${characterVoiceBlock(character)} ` +
        `Keep this same voice identity, tone, pitch and accent in every scene. ` +
        `Only pace and expressiveness may vary. Maintain accurate lip-sync and finish the ` +
        `dialogue within the scene duration without rushing or cutting off the ending.`
    );
    // Shifts the pronunciation prior towards Indian English, which helps the
    // borderline words. It is a nudge, not a control: what actually decides
    // pronunciation is how the Hindi words are spelled - see hinglish.ts.
    parts.push(
      `SPOKEN LANGUAGE. She speaks Hinglish - Hindi and English mixed in one sentence - ` +
        `in a native Indian English accent. The Hindi words are written phonetically in ` +
        `Latin script: read them as Hindi, not as English words that happen to look similar.`
    );
  }

  if (target === "video") {
    parts.push(
    `SINGLE CONTINUOUS TAKE. This is ONE unbroken shot filmed in ONE location. Do not cut ` +
      `away. Do not change the room, the background, the furniture, the time of day or the ` +
      `lighting at any point. Do not change her outfit, hair or jewellery mid-shot. Do not ` +
      `jump to a wide shot of a different place. The camera may move smoothly, and she may ` +
      `move within the frame, but the viewer must never see a second location.`
    );
  }

  parts.push(
    `RESTRICTIONS. No extra props or accessories beyond those described. No subtitles or ` +
      `on-screen text. No watermarks or logos other than the product's own.`
  );

  parts.push(
    product || productImages > 0
      ? `PRIORITY ORDER: exact product appearance, then character identity, then ${
          speaking ? "natural voice and lip-sync, then " : ""
        }scene and motion.`
      : `PRIORITY ORDER: character identity, then ${
          speaking ? "natural voice and lip-sync, then " : ""
        }scene and motion.`
  );

  return parts.join("\n\n");
}
