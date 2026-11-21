import { NextResponse } from "next/server";
import { buildFlowPackageFor } from "@/lib/flow";
import type { VideoConcept } from "@/lib/types";

/**
 * Returns everything needed to drive Google Flow by hand: the character
 * reference, the per-shot prompts, and the chained stills already on disk.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const concept: VideoConcept = body.concept;
  const draftId: string | undefined = body.draftId || undefined;
  const productUrls: string[] = Array.isArray(body.productUrls)
    ? body.productUrls.map(String).map((u: string) => u.trim()).filter(Boolean)
    : [];
  const productImages: string[] = Array.isArray(body.productImages)
    ? body.productImages.map(String).filter(Boolean)
    : [];

  if (!concept?.scenes?.length) {
    return NextResponse.json({ error: "No concept supplied" }, { status: 400 });
  }

  return NextResponse.json(
    await buildFlowPackageFor({ concept, draftId, productUrls, productImages })
  );
}
