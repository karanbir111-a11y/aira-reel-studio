import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ConceptGeneration, VideoConcept } from "./types";

// Bump on any change to the layers below. Major = behavioural/safety,
// minor = logic/output, patch = tone. Stamped onto every Video row.
export const CONCEPT_PROMPT_VERSION = "8.2.0";

/**
 * Generous on purpose. Adaptive thinking spends from the same budget as the
 * answer, so at high effort a cap sized to the expected JSON gets eaten by
 * reasoning and the response is cut off mid-string - which surfaces as an
 * unterminated-JSON parse error rather than as the budget problem it is.
 * Claude Opus 5.5 allows 128K output, and unused budget costs nothing.
 */
const MAX_OUTPUT_TOKENS = Number(process.env.CONCEPT_MAX_TOKENS) || 64000;

/**
 * Turns the SDK's structured-output failure into something actionable.
 *
 * The parse runs as the stream closes, inside the SDK, so a response cut off
 * at the budget never reaches a stop_reason check - it arrives as
 * "Unterminated string in JSON at position 13292", which tells the operator
 * nothing about what to do. Truncation and a genuine schema violation are
 * told apart by whether the JSON itself was incomplete.
 */
function describeParseFailure(err: unknown, what: string): Error | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("Failed to parse structured output")) return null;

  if (/Unterminated|Unexpected end of (JSON|input)|as JSON/i.test(message)) {
    return new Error(
      `Claude's ${what} was cut off before it finished, so the result could not be read. ` +
        `This is an output budget limit, not a bad brief: ask for fewer or shorter scenes, ` +
        `or raise CONCEPT_MAX_TOKENS (currently ${MAX_OUTPUT_TOKENS}).`
    );
  }
  return new Error(`Claude's ${what} did not match the expected shape. ${message}`);
}

/**
 * Belt and braces for the case where the budget runs out just after the JSON
 * closes, which parses cleanly but may still have dropped later fields.
 */
function assertNotTruncated(stopReason: string | null, what: string) {
  if (stopReason === "max_tokens") {
    throw new Error(
      `Claude ran out of output budget part-way through the ${what}, so the result was ` +
        `incomplete. Ask for fewer or shorter scenes, or raise CONCEPT_MAX_TOKENS ` +
        `(currently ${MAX_OUTPUT_TOKENS}).`
    );
  }
}

const SceneSchema = z.object({
  durationSec: z.number().describe("Seconds this scene is on screen"),
  visualPrompt: z.string().describe("Prompt for a STILL image generator. No camera motion, no text."),
  dialogue: z.string().describe("What she says to camera in this shot. Empty string if she does not speak in it."),
});

const ConceptSchema = z.object({
  title: z.string().describe("Short internal name"),
  hook: z.string().max(100).describe("The literal words spoken or shown in the first 1-2 seconds. Max 100 chars. The hook itself, not a description of it and not why it works."),
  voiceoverScript: z.string().describe("Exact words to be spoken, nothing else"),
  scenes: z.array(SceneSchema),
  caption: z.string().describe("Instagram caption copy"),
  hashtags: z.array(z.string()).describe("Without the # prefix"),
  musicMood: z.string().describe("Music direction, e.g. tense cinematic build"),
});

const GenerationSchema = z.object({
  sufficiency: z.enum(["sufficient", "partial", "insufficient"])
    .describe("Whether the reference analysis supports building concepts at all"),
  assumptions: z.array(z.string())
    .describe("Anything you had to fill in that the inputs did not state"),
  ambiguities: z.array(z.string())
    .describe("Conflicts or unclear points. Surface them, do not silently resolve them."),
  confidence: z.enum(["low", "medium", "high"])
    .describe("Scaled to input strength, never to how good the concepts sound"),
  productionRecommended: z.boolean()
    .describe("False if these should not be rendered into video"),
  blockers: z.array(z.string())
    .describe("Why production is not recommended. Required when productionRecommended is false."),
  brandTerms: z.array(z.string())
    .describe(
      "Every brand name, founder name, celebrity name or person's name connected to this " +
      "brief or product - including each word of a multi-word brand. The renderer strips " +
      "these before generating video because it refuses real people's names. List them even " +
      "if you did not use them."
    ),
  concepts: z.array(ConceptSchema)
    .describe("Empty array when sufficiency is insufficient"),
});

// ---------------------------------------------------------------------------
// LAYER 1 - Behavioural bedrock. Authority, prohibitions, risk posture.
// ---------------------------------------------------------------------------
const LAYER_1_BEHAVIOUR = `# ROLE AND AUTHORITY

You adapt viral Instagram Reels into new concepts for a specific brand. Your output is
consumed by an automated renderer that will spend money generating images, voice and
video from whatever you return. Treat every concept as something that WILL be produced
and published.

You may: reinterpret a reference reel's structure, and write hooks, scripts, captions
and visual direction for the brand described in the brief.

You must never:
- State or imply quantified financial returns, ROI figures, yields or price predictions.
  Banned shapes include "triple your returns", "guaranteed 20%", "prices will double".
- Guarantee any outcome, or promise a result within a timeframe. Banned shapes include
  "lose 10kg in 3 weeks", "sell your unit in 30 days".
- Make medical, health, body-composition, diagnostic or treatment claims. Banned shapes
  include "cures", "fixes your metabolism", "clinically proven".
- Invent facts about the brand, its track record, its clients or its pricing that the
  brief does not state.
- Copy the reference reel. Adapt its underlying idea only.

Curiosity, tension and strong points of view are encouraged. The prohibitions above
constrain factual claims, not energy. A hook can be bold without promising anything.

# RISK POSTURE

Scale your confidence to the strength of the inputs, never to how good the concepts
feel. Declining to produce is a correct and valued outcome: a blocked concept costs
nothing, a bad published one costs reputation. When in doubt, lower confidence and say
why rather than producing something that merely looks defensible.`;

// ---------------------------------------------------------------------------
// LAYER 3 - Input interpretation. How to treat missing/ambiguous/conflicting.
// ---------------------------------------------------------------------------
const LAYER_3_INPUT_RULES = `# HOW TO READ THE INPUTS

You receive a reference video analysis and a brand brief. Neither is guaranteed to be
complete or coherent.

Sufficiency:
- "sufficient" - the analysis describes a real reel with a discernible hook and structure.
- "partial" - it is thin, truncated or partly unreadable, but a core idea is recoverable.
  Produce concepts, lower your confidence, and list what was missing in assumptions.
- "insufficient" - it is empty, an error message, boilerplate, or does not describe a
  video at all. Return concepts as an empty array, set productionRecommended to false,
  and say why in blockers. Do not reconstruct a plausible reel from nothing.

Never infer specifics the analysis does not contain. If you do not know what was on
screen, do not assert it. Record it as an assumption instead.

Ambiguity and conflict:
- When the reference and the brand brief pull in different directions, for example the
  reference is loud hype while the brief demands calm authority, record the tension in
  ambiguities and resolve it in favour of the brief. Never resolve it silently.
- When the brief itself is internally inconsistent, surface that too rather than picking
  an interpretation and proceeding as if it were settled.

Set productionRecommended to false whenever sufficiency is "insufficient", whenever you
could only satisfy the brief by breaking a Layer 1 prohibition, or whenever you would
not stand behind the result being published.`;

const LAYER_3_PROMPT_RULES = `# HOW TO READ THE INPUTS

There is no reference reel. You receive a brand brief and a direct instruction about
what to make.

Sufficiency:
- "sufficient" - the instruction names a topic or angle you can build a reel around.
- "partial" - it is vague but workable. Produce concepts, lower confidence, and record
  what you assumed in assumptions.
- "insufficient" - it is empty, meaningless, or asks for something the brief forbids.
  Return concepts as an empty array, productionRecommended false, and say why in blockers.

Do not invent facts, statistics, product capabilities or claims the brief does not
support. An instruction to make a reel is not evidence that a claim inside it is true.

Where the instruction and the brand brief conflict, record it in ambiguities and resolve
in favour of the brief. Never resolve it silently.`;

const LAYER_3_BOTH_RULES = `# HOW TO READ THE INPUTS

You receive three things: a brand brief, an analysis of a reference reel, and a direct
instruction from the operator about what they want from it.

Order of authority when they disagree:
1. Layer 1 prohibitions - never overridden by anything.
2. The operator's direct instruction - it is the most specific and most recent signal.
3. The brand brief.
4. The reference reel - it is inspiration, not a specification.

The reference supplies structure, pacing and hook mechanics. The operator's instruction
supplies subject matter. If the instruction says to make it about a different topic than
the reference, follow the instruction and borrow only the reference's shape.

Record every conflict you resolve in ambiguities, naming which side you followed. Never
resolve one silently.

Sufficiency:
- "sufficient" - you can see a usable structure in the reference, or the instruction is
  clear enough to carry the reel on its own.
- "partial" - the reference is thin but the instruction is clear, or vice versa. Produce
  concepts, lower confidence, and note what was missing in assumptions.
- "insufficient" - neither input gives you anything to work with. Return concepts as an
  empty array, productionRecommended false, and explain in blockers.

Never invent specifics the inputs do not contain.`;

const PRODUCT_RULES = `# ADVERTISING A PRODUCT

This reel sells a specific product. What is known about it - a scraped listing, reference
photographs, or both - is supplied with this run.

- NEVER write a brand name, label text or any person's name into visualPrompt or dialogue.
  This includes inside spoken dialogue, where it is most often missed. "Guys, this
  <brand> shade is pretty" must be written as "Guys, this shade is pretty".
  The video generator refuses prompts containing real people's names, and many brands are
  named after their founder. Refer to the product generically in the footage: "the lipstick",
  "this shade", "the case". The brand belongs in the caption, never in the frame.
- The product must be visible and central. Build the shots around it, not past it.
- Describe the product's distinguishing features IN THE visualPrompt TEXT every time it
  appears: colour, material, pattern, shape, notable detail. The renderer reproduces
  described detail far more reliably than detail it is only shown.
- Use only facts given in the product details. Do not invent materials, sizes, origin,
  availability or results.
- Price may be mentioned only if supplied, and stated plainly with no claim about value
  or discount.
- Layer 1 prohibitions still bind: no guaranteed outcomes, no quantified returns, no
  health or body claims.

The operator knows the footage is AI generated and has supplied the product themselves.
Do NOT block production merely because the render will approximate rather than exactly
reproduce the item, or because brand marks may not survive generation. Record that as an
assumption and continue. Block only on a genuine factual conflict, such as the named
product disagreeing with the supplied listing.`;

/**
 * What the renderer will actually be shown of the product.
 *
 * Without this, a thin listing produces a blocker along the lines of "the data
 * lacks sleeves, neckline and dupatta, so the renderer would invent design
 * details" - correct reasoning from the wrong premise, because the operator
 * attaches the product photographs in Flow by hand and the model has no way to
 * know that. Stated either way: with photographs the gap is closed, without
 * them it is real and worth saying once.
 */
function productReferenceRules(imageCount: number, hasListing: boolean): string {
  if (imageCount > 0) {
    return `# PRODUCT REFERENCE IMAGES

${imageCount} reference photograph${imageCount > 1 ? "s" : ""} of the product ${
      imageCount > 1 ? "are" : "is"
    } attached to every generation, alongside
the character reference. The renderer therefore sees the real item: its neckline, sleeves,
hemline, cut, print placement, embroidery and trims come from the ${
      imageCount > 1 ? "photographs" : "photograph"
    }, not from
the written listing.

- Do NOT raise a blocker because the listing text omits design details. Those details are
  supplied visually. An under-described listing is not an obstacle to production here.
- Still describe the product's visible features in visualPrompt. Described detail survives
  generation more reliably than shown detail, so the two reinforce each other.
- Do not describe features you can see in neither the listing nor the brief. "As shown in
  the reference" is the correct way to leave a detail to the photograph.${
    hasListing
      ? ""
      : `
- No written listing was supplied with this run, only the ${
          imageCount > 1 ? "photographs" : "photograph"
        }. Take the product's
  identity from the operator's direction, keep visualPrompt's description of it to what
  that direction states, and leave everything else to the reference. Do not guess at a
  colour, fabric or price you were not given.`
  }`;
  }

  return `# PRODUCT REFERENCE IMAGES

No reference photographs of the product are attached. The renderer has only the written
listing, so any design detail the listing does not state will be invented.

- If the listing is too thin for the product to be recognisable - the garment type is
  given but not its neckline, sleeves, length or ornamentation, say - record that in
  'assumptions' and let it weigh on confidence.
- Raise it as a blocker only where misrepresenting the item would be the point of the
  reel: a shot built around a detail nobody has specified. A reel that shows the product
  in use, described as far as the listing allows, is still worth making.
- Where you do flag it, say plainly that attaching product photographs would resolve it.`;
}

// ---------------------------------------------------------------------------
// Production contract - hard constraints imposed by the renderer.
// ---------------------------------------------------------------------------
const PERSONA_CONTRACT_BASE = `# PRODUCTION CONTRACT (the renderer enforces these)

Each scene becomes ONE generated 10-second video shot featuring the SAME recurring
character. The character is supplied separately as reference images.

- Write EXACTLY {{SHOTS}} scenes. Each MUST have durationSec of 10. Total is {{TOTAL}} seconds.
- visualPrompt describes a moving shot: the setting, her wardrobe, what she physically
  does, camera framing, time of day, lighting and mood. Motion is expected and wanted.
- CONTINUITY IS THE DEFAULT. Scene 1 establishes the location, lighting, framing and
  her outfit. Scenes 2 and 3 keep ALL of those identical and change only what she does.
  The reel should read as one continuous moment, not a montage of different days.
  State the same location, lighting and outfit wording in every scene's visualPrompt -
  the renderer drifts the moment a detail is left unsaid.
- Change her outfit or location ONLY when the story genuinely requires it, for example a
  deliberate before-and-after. If you do, say so in assumptions.
- Do NOT describe her face, age, ethnicity, hair or build anywhere. Her identity is
  supplied separately and describing it fights the reference.
- Put NO text, letters, signage, logos, numbers or brand marks in visualPrompt. They
  render as garbled glyphs. Captions are added automatically from the voiceover.
{{SPEECH}}
- voiceoverScript contains spoken words only. No stage directions, no scene labels,
  no emoji, no hashtags.`;

const STILLS_CONTRACT = `# PRODUCTION CONTRACT (the renderer enforces these)

Each scene becomes ONE still image with a slow Ken Burns pan applied afterwards.

- visualPrompt describes a single frozen moment. No camera movement, no cuts, no
  "then the camera...". Describe subject, setting, lighting, lens feel and mood.
- Vertical 9:16 composition. Keep the subject clear of the lower third, which the
  caption band occupies.
- Put NO text, letters, signage, logos or numbers in visualPrompt. Image models render
  text as garbled glyphs. On-screen captions are generated automatically from the
  voiceover, so do not author them.
- Pace for Instagram: 6 to 10 scenes per concept, each roughly 2 to 4 seconds. A scene
  held longer than 4 seconds reads as a slideshow and loses the viewer.
- durationSec values must sum to between 15 and 45 seconds.
- voiceoverScript must fit the total duration at roughly 2.5 words per second, so a 20
  second reel is about 50 words. Count before you answer: audio that overruns the scenes
  gets truncated.
- voiceoverScript contains spoken words only. No stage directions, no scene labels, no
  emoji, no hashtags.`;

/**
 * Appended whenever she speaks on camera.
 *
 * The renderer runs the dialogue string through an English-trained speech
 * stack, so spelling - not any language hint in the prompt - decides how a
 * Hindi word sounds. Two failures were observed in production: "main" for the
 * pronoun was said as English "main", and "karenge" was said as English
 * because its ending matches "change" and "orange".
 *
 * The second kind is mechanical and gets fixed downstream in hinglish.ts. The
 * first kind cannot be: whether "main" is Hindi or English depends on meaning,
 * so only the writer of the line can resolve it. That is what this block is.
 */
const HINGLISH_CONTRACT = `# HOW THE DIALOGUE GETS PRONOUNCED

The renderer reads 'dialogue' with ENGLISH letter rules and does not know which words
are Hindi. Spelling is the only control over pronunciation. These are requirements.

- NEVER romanise a Hindi word as a word English already owns - the renderer says the
  English one. Use these spellings instead: "I" is "mei" and never "main"; "then/so" is
  "toh" and never "to"; "two" and "give" are "doh" and never "do"; "on/but" is "pur" and
  never "par"; "less" is "kum" and never "kam"; "don't" is "mutt" and never "mat";
  "time/occasion" is "baar" and never "bar".
- Better still, cut the ambiguous word. Hindi drops subject pronouns freely, so
  "tumhare outfits ko dene wali hoon" says exactly what "main tumhare outfits ko dene
  wali hoon" says, and has nothing left to mispronounce.
- NEVER let one spelling carry two languages in the same line. "Aur main tumhare basic
  outfits ko dene wali hoon... main character energy" forces the renderer to pick one
  reading of "main", so one of the two comes out wrong. Rewrite until the clash is gone.
- Double long vowels: "baat" not "bat", "theek" not "thik", "saaf" not "saf".
- Switch language at clause boundaries, not inside a clause. A whole English phrase
  sitting in a Hindi sentence is read correctly - "main character energy", "glow-up",
  "follow button" all work. A lone English word mid-Hindi-clause is the risky case, and
  so is a lone Hindi word mid-English-clause.
- Latin script only. Devanagari renders as garbled glyphs further down the pipeline.`;

/**
 * Shots are a fixed 8 seconds each, so the requested duration decides how many
 * there are - and whether she talks changes where the audio comes from.
 */
function personaContract(targetSeconds: number, speaking: boolean): string {
  const shots = Math.max(1, Math.round(targetSeconds / 10));
  const speech = speaking
    ? `- She SPEAKS TO CAMERA. Give every scene a 'dialogue' line: the exact words she says,
  at most 25 words per 10-second shot so it is never rushed. Write it the way she talks,
  not the way copy is written.
- Dialogue must flow continuously across the scenes as one spoken piece. Do not restate
  the same point in two scenes.
- voiceoverScript is the full dialogue joined together, so captions can be timed from it.
  It is DISPLAYED on screen, not spoken, so write it in normal readable spelling: the
  same words as dialogue, without the phonetic spelling the pronunciation rules ask for.`
    : `- She does not speak on camera. Leave every 'dialogue' field as an empty string.
- voiceoverScript is narration laid over the footage, roughly 2.5 words per second,
  so about ${Math.round(shots * 8 * 2.4)} words for ${shots * 10} seconds. Count before answering.`;

  const base = PERSONA_CONTRACT_BASE.replace("{{SHOTS}}", String(shots))
    .replace("{{TOTAL}}", String(shots * 10))
    .replace("{{SPEECH}}", speech);

  return speaking ? `${base}\n\n${HINGLISH_CONTRACT}` : base;
}

export type RenderMode = "stills" | "persona";

export interface ConceptRequest {
  /**
   * Layer 2 - the per-config brand brief. Optional: a run can rely on the
   * always-on brand profile and the operator's own direction instead.
   */
  brief?: string;
  /** Mode A: Gemini's analysis of a competitor reel. */
  referenceAnalysis?: string;
  /** Mode B: a direct instruction, with no reference reel. */
  directPrompt?: string;
  /** Always-on brand rules, rendered by brandBlock(). Optional. */
  globalBrand?: string;
  /** Condensed product spec when the reel is advertising something. */
  product?: string;
  /**
   * How many reference photographs of the product the operator has attached
   * for the renderer. Changes what can be known about the item, so it changes
   * whether an under-described listing is a blocker.
   */
  productImageCount?: number;
  renderMode: RenderMode;
  /** Drives shot count: each generated shot is a fixed 8 seconds. */
  targetSeconds?: number;
  /** When true she talks to camera and Veo generates her speech. */
  speaking?: boolean;
}

/**
 * Assembles the cacheable system block.
 *
 * Exported so the exact text sent can be inspected without a billed call. The
 * layers assert what the model will receive, so a layer promising an input
 * that is not there reads to the model as a broken pipeline rather than as an
 * omission - which is what the no-brief notice below exists to correct.
 */
export function conceptSystemPrompt(req: ConceptRequest): string {
  const {
    brief,
    referenceAnalysis,
    directPrompt,
    globalBrand,
    product,
    productImageCount = 0,
    renderMode,
    targetSeconds = 24,
    speaking = false,
  } = req;

  const hasBrief = Boolean(brief?.trim());
  const hasBrand = Boolean(globalBrand?.trim());
  // Photographs alone make it a product reel: a listing that could not be
  // scraped, or an item with no page at all, is still an item being sold.
  const hasListing = Boolean(product?.trim());
  const hasProduct = hasListing || productImageCount > 0;

  return [
    LAYER_1_BEHAVIOUR,
    referenceAnalysis && directPrompt
      ? LAYER_3_BOTH_RULES
      : referenceAnalysis
        ? LAYER_3_INPUT_RULES
        : LAYER_3_PROMPT_RULES,
    renderMode === "persona" ? personaContract(targetSeconds, speaking) : STILLS_CONTRACT,
    // Only when something is actually being sold. These rules carry the brand
    // redaction requirement and, as importantly, the instruction not to block
    // merely because a render approximates the item.
    hasProduct ? PRODUCT_RULES : "",
    hasProduct ? productReferenceRules(productImageCount, hasListing) : "",
    // brandBlock already carries its own heading, so none is added here.
    hasBrand ? globalBrand : "",
    hasBrief ? `# BRAND BRIEF (Layer 2)\n\n${brief}` : "",
    // Every Layer 3 variant states that a brand brief is supplied. That is now
    // only sometimes true, and an unexplained gap gets reported as a template
    // failure, so the contradiction is retracted explicitly rather than left
    // for the model to interpret.
    !hasBrief
      ? `# NO CLIENT BRIEF\n\nNo client brief was supplied for this run, and that is a valid ` +
        `state, not a fault: the brief is optional. Where a rule above says you receive a ` +
        `brand brief, treat it as not provided. Do not report a pipeline or template error.\n\n` +
        (hasBrand
          ? `The brand profile above is the standing brand input. Work from it plus the ` +
            `operator's direction, and do not treat the missing brief as missing brand ` +
            `information that the profile already covers.`
          : `There is no brand input at all. Work from the operator's direction and the ` +
            `reference alone.`) +
        `\n\nDo not invent a brand, positioning, product or audience to fill what is genuinely ` +
        `absent. Record what you had to assume in 'assumptions', and let sufficiency and ` +
        `confidence reflect only what is actually missing.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export async function generateConcepts(req: ConceptRequest): Promise<ConceptGeneration> {
  const { referenceAnalysis, directPrompt, product } = req;
  if (!referenceAnalysis && !directPrompt) {
    throw new Error("generateConcepts needs either referenceAnalysis or directPrompt");
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  // Layers 1/3, the contract and the brief are fixed for a whole run, so the
  // system block is cacheable. Only the per-request input rides in the user turn.
  const system = conceptSystemPrompt(req);

  const userTurn = [
    referenceAnalysis ? `# REFERENCE VIDEO ANALYSIS\n\n${referenceAnalysis}` : "",
    directPrompt ? `# OPERATOR DIRECTION\n\n${directPrompt}` : "",
    product ? `# PRODUCT BEING ADVERTISED\n\n${product}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  try {
    // Streamed because the budget below is large: a non-streaming request that
    // could run for many minutes risks the SDK's own request timeout.
    const response = await client.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: zodOutputFormat(GenerationSchema),
        },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userTurn }],
      })
      .finalMessage();

    if (response.stop_reason === "refusal") {
      throw new Error(
        `Claude declined this request: ${response.stop_details?.explanation ?? "no explanation"}`
      );
    }
    assertNotTruncated(response.stop_reason, "concept generation");
    if (!response.parsed_output) {
      throw new Error("Claude returned no parseable generation");
    }

    return { ...response.parsed_output, promptVersion: CONCEPT_PROMPT_VERSION };
  } catch (err) {
    const parseFailure = describeParseFailure(err, "concept generation");
    if (parseFailure) throw parseFailure;
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("Anthropic rate limit hit - retry later");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("ANTHROPIC_API_KEY is invalid");
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error ${err.status}: ${err.message}`);
    }
    throw err;
  }
}

export function conceptsToMarkdown(gen: ConceptGeneration): string {
  const list = (items: string[]) => items.map((x) => `- ${x}`).join("\n");

  const head = [
    `**Sufficiency:** ${gen.sufficiency} | **Confidence:** ${gen.confidence} | **Production:** ${gen.productionRecommended ? "recommended" : "BLOCKED"}`,
    gen.blockers.length ? `**Blockers**\n\n${list(gen.blockers)}` : "",
    gen.ambiguities.length ? `**Ambiguities**\n\n${list(gen.ambiguities)}` : "",
    gen.assumptions.length ? `**Assumptions**\n\n${list(gen.assumptions)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const body = gen.concepts
    .map((c: VideoConcept, i: number) => {
      const scenes = c.scenes
        .map((s, j) => `${j + 1}. **${s.durationSec}s** — ${s.visualPrompt}`)
        .join("\n");

      return [
        `## ${i + 1}. ${c.title}`,
        `**Hook:** ${c.hook}`,
        `**Voiceover**\n\n${c.voiceoverScript}`,
        `**Scenes**\n\n${scenes}`,
        `**Caption**\n\n${c.caption}`,
        `**Hashtags:** ${c.hashtags.map((h) => `#${h}`).join(" ")}`,
        `**Music:** ${c.musicMood}`,
      ].join("\n\n");
    })
    .join("\n\n---\n\n");

  return body ? `${head}\n\n---\n\n${body}` : head;
}

// ---------------------------------------------------------------------------
// SINGLE-SHOT REVISION
//
// Rendering a shot in Flow costs real money and several minutes of hand work,
// so the expensive mistake is not a bad shot - it is a fix that invalidates the
// shots either side of it. Everything below exists to keep one edit local.
// ---------------------------------------------------------------------------

const ReviseSchema = z.object({
  applied: z.boolean().describe(
    "False when the feedback cannot be honoured inside this one shot. Say so instead of " +
    "making a change that forces the other shots to be re-rendered."
  ),
  notApplicableReason: z.string().describe(
    "Why it could not be done within this shot. Required when applied is false, empty otherwise."
  ),
  visualPrompt: z.string().describe(
    "The revised visual prompt. When applied is false, return the original unchanged."
  ),
  dialogue: z.string().describe(
    "The revised spoken line, or the original unchanged. Empty string if she does not speak " +
    "in this shot and did not before."
  ),
  changed: z.array(z.string()).describe(
    "What you actually changed, one short line each. Empty when nothing changed."
  ),
  otherShotsAffected: z.array(z.number()).describe(
    "1-based shot numbers that would ALSO have to be re-rendered for the reel to still cut " +
    "together. Empty is the goal. Non-empty is a warning, not a licence to edit them."
  ),
  continuityRisks: z.array(z.string()).describe(
    "Ways this edit might still not match its neighbours once rendered. Surface doubts here " +
    "rather than resolving them silently."
  ),
});

const REVISE_CONTRACT = `# ROLE

You are revising ONE shot of a reel that has already been rendered. The operator has the
other shots as finished video files and is not going to re-render them. They want to
re-render this shot alone, drop it back into the timeline, and have the reel still cut
together.

# WHAT YOU MAY CHANGE

Only the shot you are given, and only its visualPrompt and dialogue.

# HARD CONSTRAINTS

- The revised shot must still sit between its neighbours invisibly. The location, the
  furniture, the time of day, the lighting, her outfit, hair and jewellery must stay
  exactly as the surrounding shots describe them, in the same wording. Reusing the same
  phrasing is the point: the renderer invents a new room the moment a detail is reworded.
- Her pose, her action, the camera framing and the spoken line are yours to change.
- If honouring the feedback would require changing any locked detail, or changing a
  neighbouring shot, set applied to false and explain why. Do not quietly widen the edit.
  A shot that no longer matches its neighbours costs the operator the whole reel, not
  one render.
- Dialogue drives the timing of every caption after it, so keep the revised line within
  roughly 15% of the original word count. If the feedback cannot be said in that space,
  set applied to false.
- Keep this shot's job in the script. If it was the hook it stays the hook; if it closed
  with the call to action it still closes with one. The surrounding dialogue is fixed and
  must still read continuously through this line.
- Do NOT describe her face, age, ethnicity, hair or build. Her identity is supplied
  separately as a reference image, and describing it fights the reference.
- Put NO text, letters, signage, logos, numbers or brand marks in visualPrompt. They
  render as garbled glyphs.
- Never write a brand name, a label or any real person's name into visualPrompt or
  dialogue. Generators refuse real people's names, and many brands carry a founder's.`;

export interface ReviseRequest {
  concept: VideoConcept;
  /** 0-based index into concept.scenes. */
  shotIndex: number;
  /** The operator's note on what is wrong with the rendered clip. */
  feedback: string;
  product?: string;
  speaking: boolean;
}

export interface ReviseResult {
  applied: boolean;
  notApplicableReason: string;
  visualPrompt: string;
  dialogue: string;
  changed: string[];
  otherShotsAffected: number[];
  continuityRisks: string[];
  promptVersion: string;
}

/**
 * Rewrites one scene against operator feedback, holding everything else fixed.
 *
 * The whole concept goes in the request even though one scene comes back: the
 * model cannot judge whether an edit breaks continuity, or whether the line
 * still reads into the next one, without seeing the shots around it.
 */
export async function reviseShot(req: ReviseRequest): Promise<ReviseResult> {
  const { concept, shotIndex, feedback, product, speaking } = req;

  const scene = concept.scenes[shotIndex];
  if (!scene) throw new Error(`Shot ${shotIndex + 1} is not in this concept`);
  if (!feedback.trim()) throw new Error("Revision feedback is empty");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const system = [
    REVISE_CONTRACT,
    speaking ? HINGLISH_CONTRACT : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  // Neighbours are given as the locked context they are: finished video that
  // this shot has to match, not material to be improved.
  const timeline = concept.scenes
    .map((s, i) => {
      const label =
        i === shotIndex
          ? `## Shot ${i + 1} - THE SHOT YOU ARE REVISING`
          : `## Shot ${i + 1} - ALREADY RENDERED, FIXED`;
      return [
        label,
        `Duration: ${s.durationSec}s`,
        `Visual: ${s.visualPrompt}`,
        s.dialogue ? `Dialogue: ${s.dialogue}` : `Dialogue: (silent)`,
      ].join("\n");
    })
    .join("\n\n");

  const wordCount = (scene.dialogue ?? "").trim().split(/\s+/).filter(Boolean).length;

  const userTurn = [
    `# THE REEL\n\nTitle: ${concept.title}\nHook: ${concept.hook}`,
    `# THE TIMELINE\n\n${timeline}`,
    product ? `# PRODUCT BEING ADVERTISED\n\n${product}` : "",
    `# OPERATOR FEEDBACK ON SHOT ${shotIndex + 1}\n\n${feedback.trim()}`,
    `# BUDGET\n\nThe original line is ${wordCount} words. Stay within 15% of that.`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  try {
    const response = await client.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: zodOutputFormat(ReviseSchema),
        },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userTurn }],
      })
      .finalMessage();

    if (response.stop_reason === "refusal") {
      throw new Error(
        `Claude declined this revision: ${response.stop_details?.explanation ?? "no explanation"}`
      );
    }
    assertNotTruncated(response.stop_reason, "shot revision");
    if (!response.parsed_output) throw new Error("Claude returned no parseable revision");

    return { ...response.parsed_output, promptVersion: CONCEPT_PROMPT_VERSION };
  } catch (err) {
    const parseFailure = describeParseFailure(err, "shot revision");
    if (parseFailure) throw parseFailure;
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("Anthropic rate limit hit - retry later");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("ANTHROPIC_API_KEY is invalid");
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error ${err.status}: ${err.message}`);
    }
    throw err;
  }
}
