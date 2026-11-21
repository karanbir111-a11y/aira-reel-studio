import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import type { Config, ConceptScene, Creator, Reel, Video, VideoConcept } from "./types";

const DATA_DIR = path.join(process.cwd(), "..", "data");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readCsv<T>(filename: string): T[] {
  const filepath = path.join(DATA_DIR, filename);
  if (!existsSync(filepath)) return [];
  const content = readFileSync(filepath, "utf-8");
  if (!content.trim()) return [];
  return parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true }) as T[];
}

function writeCsv(filename: string, data: Record<string, unknown>[], columns: string[]) {
  ensureDataDir();
  const filepath = path.join(DATA_DIR, filename);
  const output = stringify(data, { header: true, columns });
  writeFileSync(filepath, output, "utf-8");
}

// Configs
const CONFIG_COLUMNS = ["id", "configName", "creatorsCategory", "analysisInstruction", "newConceptsInstruction"];

export function readConfigs(): Config[] {
  return readCsv<Config>("configs.csv");
}

export function writeConfigs(configs: Config[]) {
  writeCsv("configs.csv", configs as unknown as Record<string, unknown>[], CONFIG_COLUMNS);
}

// Creators
const CREATOR_COLUMNS = ["id", "username", "category", "profilePicUrl", "followers", "reelsCount30d", "avgViews30d", "lastScrapedAt"];

export function readCreators(): Creator[] {
  const raw = readCsv<Record<string, string>>("creators.csv");
  return raw.map((r) => ({
    id: r.id || "",
    username: r.username || "",
    category: r.category || "",
    profilePicUrl: r.profilePicUrl || "",
    followers: parseInt(r.followers || "0", 10) || 0,
    reelsCount30d: parseInt(r.reelsCount30d || "0", 10) || 0,
    avgViews30d: parseInt(r.avgViews30d || "0", 10) || 0,
    lastScrapedAt: r.lastScrapedAt || "",
  }));
}

export function writeCreators(creators: Creator[]) {
  writeCsv("creators.csv", creators as unknown as Record<string, unknown>[], CREATOR_COLUMNS);
}

// Videos
const VIDEO_COLUMNS = ["id", "link", "thumbnail", "creator", "views", "likes", "comments", "analysis", "concepts", "newConcepts", "sufficiency", "confidence", "productionRecommended", "blockers", "assumptions", "ambiguities", "promptVersion", "datePosted", "dateAdded", "configName", "starred"];

export function readVideos(): Video[] {
  const raw = readCsv<Record<string, string>>("videos.csv");
  return raw.map((r) => ({
    id: r.id || "",
    link: r.link || r.Link || "",
    thumbnail: r.thumbnail || r.Thumbnail || "",
    creator: r.creator || r.Creator || "",
    views: parseInt(r.views || r.Views || "0", 10) || 0,
    likes: parseInt(r.likes || r.Likes || "0", 10) || 0,
    comments: parseInt(r.comments || r.Comments || "0", 10) || 0,
    analysis: r.analysis || r.Analysis || "",
    concepts: parseConcepts(r.concepts),
    sufficiency: r.sufficiency || "",
    confidence: r.confidence || "",
    productionRecommended: r.productionRecommended === "true",
    blockers: parseStrings(r.blockers),
    assumptions: parseStrings(r.assumptions),
    ambiguities: parseStrings(r.ambiguities),
    promptVersion: r.promptVersion || "",
    newConcepts: r.newConcepts || r["newConcepts"] || r["New Concepts"] || "",
    datePosted: r.datePosted || r["Date Posted"] || r["datePosted"] || "",
    dateAdded: r.dateAdded || r["Date Added"] || r["dateAdded"] || "",
    configName: r.configName || r["Config Name"] || r["configName"] || "",
    starred: r.starred === "true",
  }));
}

function parseStrings(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseConcepts(raw: string | undefined): VideoConcept[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeVideos(videos: Video[]) {
  const rows = videos.map((v) => ({
    ...v,
    concepts: JSON.stringify(v.concepts),
    blockers: JSON.stringify(v.blockers),
    assumptions: JSON.stringify(v.assumptions),
    ambiguities: JSON.stringify(v.ambiguities),
  }));
  writeCsv("videos.csv", rows as unknown as Record<string, unknown>[], VIDEO_COLUMNS);
}

export function appendVideo(video: Video) {
  const videos = readVideos();
  videos.push(video);
  writeVideos(videos);
}

// Reels
const REEL_COLUMNS = [
  "id", "title", "hook", "caption", "hashtags", "voiceoverScript", "scenes",
  "clips", "videoUrl", "durationSec", "configName", "renderMode", "musicUsed",
  "status", "createdAt",
];

function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readReels(): Reel[] {
  const raw = readCsv<Record<string, string>>("reels.csv");
  return raw.map((r) => ({
    id: r.id || "",
    title: r.title || "",
    hook: r.hook || "",
    caption: r.caption || "",
    hashtags: parseJsonArray<string>(r.hashtags),
    voiceoverScript: r.voiceoverScript || "",
    scenes: parseJsonArray<ConceptScene>(r.scenes),
    clips: parseJsonArray<string>(r.clips),
    videoUrl: r.videoUrl || "",
    durationSec: parseFloat(r.durationSec || "0") || 0,
    configName: r.configName || "",
    renderMode: r.renderMode || "",
    musicUsed: r.musicUsed || "",
    status: (r.status as Reel["status"]) || "draft",
    createdAt: r.createdAt || "",
  }));
}

export function writeReels(reels: Reel[]) {
  const rows = reels.map((r) => ({
    ...r,
    hashtags: JSON.stringify(r.hashtags),
    scenes: JSON.stringify(r.scenes),
    clips: JSON.stringify(r.clips),
  }));
  writeCsv("reels.csv", rows as unknown as Record<string, unknown>[], REEL_COLUMNS);
}

/** Insert or replace by id, newest first. */
export function upsertReel(reel: Reel) {
  const reels = readReels().filter((r) => r.id !== reel.id);
  writeReels([reel, ...reels]);
}
