export interface Config {
  id: string;
  configName: string;
  creatorsCategory: string;
  analysisInstruction: string;
  newConceptsInstruction: string;
}

export interface Creator {
  id: string;
  username: string;
  category: string;
  profilePicUrl: string;
  followers: number;
  reelsCount30d: number;
  avgViews30d: number;
  lastScrapedAt: string;
}

export interface ConceptScene {
  durationSec: number;
  visualPrompt: string;
  dialogue?: string;
}

export interface VideoConcept {
  title: string;
  hook: string;
  voiceoverScript: string;
  scenes: ConceptScene[];
  caption: string;
  hashtags: string[];
  musicMood: string;
}

export interface ConceptGeneration {
  sufficiency: "sufficient" | "partial" | "insufficient";
  assumptions: string[];
  ambiguities: string[];
  confidence: "low" | "medium" | "high";
  productionRecommended: boolean;
  blockers: string[];
  brandTerms?: string[];
  concepts: VideoConcept[];
  promptVersion: string;
}

export interface Video {
  id: string;
  link: string;
  thumbnail: string;
  creator: string;
  views: number;
  likes: number;
  comments: number;
  analysis: string;
  concepts: VideoConcept[];
  newConcepts: string;
  sufficiency: string;
  confidence: string;
  productionRecommended: boolean;
  blockers: string[];
  assumptions: string[];
  ambiguities: string[];
  promptVersion: string;
  datePosted: string;
  dateAdded: string;
  configName: string;
  starred: boolean;
}

export interface PipelineParams {
  configName: string;
  maxVideos: number;
  topK: number;
  nDays: number;
}

export interface ActiveTask {
  id: string;
  creator: string;
  step: string;
  views?: number;
}

export interface PipelineProgress {
  status: "idle" | "running" | "completed" | "error";
  phase: "scraping" | "analyzing" | "done";
  activeTasks: ActiveTask[];
  creatorsCompleted: number;
  creatorsTotal: number;
  creatorsScraped: number;
  videosAnalyzed: number;
  videosTotal: number;
  errors: string[];
  log: string[];
}

export interface Reel {
  id: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  /** Spoken narration - kept so captions can be rebuilt without re-rendering. */
  voiceoverScript: string;
  /** Per-clip prompts, so a single shot can be re-rolled in isolation. */
  scenes: ConceptScene[];
  clips: string[];
  videoUrl: string;
  durationSec: number;
  configName: string;
  renderMode: string;
  musicUsed: string;
  status: "draft" | "approved" | "posted";
  createdAt: string;
}

/**
 * Always-on brand rules, layered under every per-config brief.
 * Entirely optional - an empty profile changes nothing.
 */
export interface BrandProfile {
  brandName: string;
  about: string;
  audience: string;
  toneRules: string;
  alwaysEnsure: string;
  alwaysAvoid: string;
  updatedAt: string;
}

export interface StoryboardShot {
  index: number;
  prompt: string;
  imageUrl: string;
  approved: boolean;
}

// ---------------------------------------------------------------------------
// Flow hand-off. Declared here rather than in flow.ts so that client pages can
// import the shape without pulling in that module's fs and ffmpeg imports.
// ---------------------------------------------------------------------------

export interface FlowShot {
  index: number;
  /** Present only when a storyboard was built in this app. */
  imageUrl?: string;
  imagePrompt: string;
  videoPrompt: string;
  /** Readable spelling, for the operator. The prompt carries the spoken one. */
  dialogue: string;
}

export interface FlowPackage {
  characterPrompt: string;
  characterImageUrl: string;
  /**
   * Local URLs of product reference photographs, to attach in Flow beside the
   * character image. Empty when the product is described in words only.
   */
  productImageUrls: string[];
  shots: FlowShot[];
  caption: string;
  hashtags: string[];
  removedTerms: string[];
  /** Hindi words respelled for the speech engine, so the change is reviewable. */
  respellings: { from: string; to: string }[];
  hasStoryboard: boolean;
}

/** Per-shot state an operator accumulates while working through Flow. */
export interface DraftShot {
  /** Ticked by hand once the clip has been rendered and downloaded. */
  rendered: boolean;
  /** Revision notes applied so far, oldest first. */
  revisions: string[];
}

/**
 * A saved reel in progress.
 *
 * Flow has no API, so a reel is rendered by hand over minutes or hours, in
 * another tab, while this app may reload or restart. The prompts therefore
 * cannot live in React state alone: losing them means losing the ability to
 * re-render one shot without regenerating the whole concept.
 */
export interface Draft {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  configName: string;
  /** Kept so a revised shot's prompts can be rebuilt with the same product lock. */
  productUrls: string[];
  /** Local URLs of the product reference photographs, as served from public/. */
  productImages: string[];
  targetSeconds: number;
  speaking: boolean;
  concept: VideoConcept;
  flow: FlowPackage;
  /** Keyed by shot index as a string, because JSON object keys are strings. */
  shots: Record<string, DraftShot>;
  notes: string;
}

/** List-view row. Cheap to build, so the index page never parses every concept. */
export interface DraftSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  configName: string;
  shotCount: number;
  renderedCount: number;
}
