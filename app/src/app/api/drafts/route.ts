import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { listDrafts, readDraft, writeDraft, deleteDraft } from "@/lib/drafts";
import type { Draft } from "@/lib/types";

/** `?id=` returns one draft in full; without it, a summary of every draft. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) return NextResponse.json(listDrafts());

  // readDraft throws on an id outside the allowed charset rather than
  // sanitising it, so a rejected id is a bad request, not a server fault.
  try {
    const draft = readDraft(id);
    if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/**
 * Upsert. The id is assigned here when absent so that it matches the storyboard
 * directory under public/reels, which the same id already names.
 */
export async function POST(request: Request) {
  const body = await request.json();

  if (!body.concept || !body.flow) {
    return NextResponse.json(
      { error: "A draft needs both a concept and a built Flow package" },
      { status: 400 }
    );
  }

  const id: string = body.id || uuid().slice(0, 8);
  const existing = readDraft(id);

  const draft: Draft = {
    id,
    title: body.title || body.concept.title || "Untitled reel",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    configName: body.configName ?? existing?.configName ?? "",
    productUrls: Array.isArray(body.productUrls)
      ? body.productUrls.map(String).map((u: string) => u.trim()).filter(Boolean)
      : existing?.productUrls ?? [],
    productImages: Array.isArray(body.productImages)
      ? body.productImages.map(String).filter(Boolean)
      : existing?.productImages ?? [],
    targetSeconds: Number(body.targetSeconds) || existing?.targetSeconds || 30,
    speaking: typeof body.speaking === "boolean" ? body.speaking : existing?.speaking ?? true,
    concept: body.concept,
    flow: body.flow,
    // Progress is owned by the draft, not by whoever is saving: a re-save from
    // the create page must not wipe ticks made on the draft page.
    shots: body.shots ?? existing?.shots ?? {},
    notes: body.notes ?? existing?.notes ?? "",
  };

  return NextResponse.json(writeDraft(draft));
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    if (!deleteDraft(id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
  return NextResponse.json({ success: true });
}
