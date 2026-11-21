import fs from "fs";
import path from "path";
import type { Draft, DraftSummary } from "./types";

/**
 * Drafts are one JSON file each, not rows in a CSV like the rest of the data
 * directory.
 *
 * A draft holds whole prompt blocks - multi-paragraph text with quotes and
 * newlines in it - and the CSV layer here stores nested values by
 * JSON.stringify-ing them into a cell. That survives a round trip, but it
 * makes the file unreadable exactly when you need to read it: when the app
 * will not start and the prompts are the only copy of an hour's work.
 */
const DRAFTS_DIR = path.join(process.cwd(), "..", "data", "drafts");

function ensureDir() {
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });
}

/**
 * Ids reach this module from a URL, so a traversal attempt must not be able to
 * read or write outside the drafts directory. Anything but the id charset the
 * app generates is rejected rather than sanitised.
 */
function draftPath(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Invalid draft id: ${id}`);
  return path.join(DRAFTS_DIR, `${id}.json`);
}

export function readDraft(id: string): Draft | null {
  const file = draftPath(id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Draft;
  } catch {
    // A half-written file must not take down the list view.
    return null;
  }
}

export function writeDraft(draft: Draft): Draft {
  ensureDir();
  const next: Draft = { ...draft, updatedAt: new Date().toISOString() };
  // Written to a sibling first and renamed, because the process can be killed
  // mid-save and a truncated draft is worse than a stale one.
  const file = draftPath(next.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}

export function deleteDraft(id: string): boolean {
  const file = draftPath(id);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

/** Newest first, by the time of the last edit rather than of creation. */
export function listDrafts(): DraftSummary[] {
  ensureDir();
  return fs
    .readdirSync(DRAFTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readDraft(f.replace(/\.json$/, "")))
    .filter((d): d is Draft => d !== null)
    .map((d) => ({
      id: d.id,
      title: d.title,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      configName: d.configName,
      shotCount: d.flow?.shots?.length ?? d.concept?.scenes?.length ?? 0,
      renderedCount: Object.values(d.shots ?? {}).filter((s) => s.rendered).length,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
