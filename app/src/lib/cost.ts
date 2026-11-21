/**
 * Single source of truth for cost estimates shown in the UI.
 * Veo dominates everything else by an order of magnitude.
 */
export const RATES = {
  // Omni bills video output tokens at 5,792 tokens per second of 720p.
  omniPerSec720p: 0.10,
  omniPerSec1080p: 0.12,
  geminiImage: 0.04,
  videoAnalysis: 0.20,
  conceptGeneration: 0.15,
  voiceover: 0.01,
} as const;

export const SHOT_SECONDS = 10;

export function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Cost of turning briefs into concepts - what step 1 commits you to. */
export function estimateConcepts(referenceCount: number): number {
  return referenceCount * RATES.videoAnalysis + RATES.conceptGeneration;
}

/** One still per shot. The cheap approval gate before any video spend. */
export function estimateStoryboard(shotCount: number): number {
  return shotCount * RATES.geminiImage;
}

export function estimateVideo(shotCount: number, resolution: "720p" | "1080p" = "1080p"): number {
  const perSec = resolution === "1080p" ? RATES.omniPerSec1080p : RATES.omniPerSec720p;
  return shotCount * SHOT_SECONDS * perSec + RATES.voiceover;
}

export function estimateReroll(resolution: "720p" | "1080p" = "1080p"): number {
  return estimateVideo(1, resolution) - RATES.voiceover;
}
