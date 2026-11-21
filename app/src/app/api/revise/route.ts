import { NextResponse } from "next/server";
import { reviseShot } from "@/lib/claude";
import { buildFlowPackageFor } from "@/lib/flow";
import { readDraft, writeDraft } from "@/lib/drafts";
import { scrapeProducts, productsBrief } from "@/lib/product";
import type { Draft } from "@/lib/types";

export const maxDuration = 300;

/**
 * Revises one shot of a saved draft against operator feedback.
 *
 * The point is a local edit: the operator has the other clips as finished video
 * and will re-render only this one. So when the model reports that the feedback
 * cannot be contained in this shot, nothing is written - a saved draft whose
 * prompts no longer match the rendered clips is worse than no edit at all.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const id = String(body.id ?? "").trim();
    const shotIndex = Number(body.shotIndex);
    const feedback = String(body.feedback ?? "");

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!Number.isInteger(shotIndex) || shotIndex < 0) {
      return NextResponse.json({ error: "shotIndex must be a shot number" }, { status: 400 });
    }
    if (!feedback.trim()) {
      return NextResponse.json({ error: "Say what needs to change" }, { status: 400 });
    }

    const draft = readDraft(id);
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (!draft.concept.scenes[shotIndex]) {
      return NextResponse.json(
        { error: `Shot ${shotIndex + 1} is not in this draft` },
        { status: 400 }
      );
    }

    // The full brief, not the visual one: Claude is writing copy here, and the
    // price and the blurb are what a spoken line is built from.
    let product: string | undefined;
    if (draft.productUrls.length) {
      const products = await scrapeProducts(draft.productUrls);
      if (products.length) product = productsBrief(products);
    }

    const result = await reviseShot({
      concept: draft.concept,
      shotIndex,
      feedback,
      product,
      speaking: draft.speaking,
    });

    if (!result.applied) {
      return NextResponse.json({ ...result, saved: false });
    }

    const scenes = draft.concept.scenes.map((s, i) =>
      i === shotIndex
        ? { ...s, visualPrompt: result.visualPrompt, dialogue: result.dialogue }
        : s
    );

    // Captions are timed from voiceoverScript, so a changed line has to reach
    // it or the burned-in text drifts out of sync with the new audio.
    const concept = {
      ...draft.concept,
      scenes,
      voiceoverScript: scenes
        .map((s) => (s.dialogue ?? "").trim())
        .filter(Boolean)
        .join(" "),
    };

    const flow = await buildFlowPackageFor({
      concept,
      draftId: draft.id,
      productUrls: draft.productUrls,
      // Drafts saved before product images existed have no field here, and a
      // rebuild must not silently drop the lock wording from the other shots.
      productImages: draft.productImages ?? draft.flow.productImageUrls ?? [],
    });

    const shots = { ...draft.shots };
    const previous = shots[String(shotIndex)];
    shots[String(shotIndex)] = {
      // The clip on disk is now the old version of this shot, so it stops
      // counting as rendered until the operator brings the new one back.
      rendered: false,
      revisions: [...(previous?.revisions ?? []), feedback.trim()],
    };

    const updated: Draft = { ...draft, concept, flow, shots };
    writeDraft(updated);

    return NextResponse.json({ ...result, saved: true, draft: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
