/**
 * End-to-end smoke test: reference reel -> concepts -> gate -> finished mp4.
 *
 *   npm run produce                                   newest analysed video, reuses its config
 *   npm run produce -- --config "AI Blog Content"     pick the brief
 *   npm run produce -- --concept 2                    render a different concept
 *   npm run produce -- --live --creator nick_saraev   scrape + analyse fresh instead
 *   npm run produce -- --dry                          stop after the gate, spend nothing on render
 */
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";

dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

import { parse } from "csv-parse/sync";
import { generateConcepts } from "../src/lib/claude";
import { gateCheck, produceReel } from "../src/lib/video/produce";
import type { VideoConcept } from "../src/lib/types";
import { scrapeReels } from "../src/lib/apify";
import { uploadVideo, analyzeVideo } from "../src/lib/gemini";

const DATA = path.resolve(process.cwd(), "..", "data");
const OUT_ROOT = path.resolve(process.cwd(), "..", "output");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function preflight() {
  const problems: string[] = [];

  for (const bin of ["ffmpeg", "ffprobe"]) {
    const r = spawnSync(bin, ["-version"], { encoding: "utf-8" });
    if (r.error) {
      problems.push(
        `${bin} not on PATH. It is installed but your shell may predate the install - open a NEW terminal.`
      );
    }
  }
  for (const key of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"]) {
    if (!process.env[key]) problems.push(`${key} missing from ../.env`);
  }
  if (has("live") && !process.env.APIFY_API_TOKEN) {
    problems.push("APIFY_API_TOKEN missing (required for --live)");
  }

  if (problems.length) {
    console.error("\nPreflight failed:\n" + problems.map((p) => `  - ${p}`).join("\n") + "\n");
    process.exit(1);
  }
  console.log("preflight ok (ffmpeg, ffprobe, api keys)\n");
}

function readCsv(file: string): Record<string, string>[] {
  return parse(fs.readFileSync(path.join(DATA, file), "utf8"), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

async function getAnalysisFromCsv(configName?: string) {
  const videos = readCsv("videos.csv").filter((v) => (v.analysis || "").length > 500);
  if (!videos.length) throw new Error("no analysed videos in videos.csv");
  const picked = configName
    ? videos.filter((v) => v.configName === configName).pop() ?? videos[videos.length - 1]
    : videos[videos.length - 1];
  console.log(`source: videos.csv  @${picked.creator}  ${Number(picked.views).toLocaleString()} views`);
  return { analysis: picked.analysis, configName: configName ?? picked.configName };
}

async function getAnalysisLive(creator: string, analysisInstruction: string) {
  console.log(`scraping @${creator} ...`);
  const reels = await scrapeReels(creator, 10, 30);
  const usable = reels
    .filter((r) => r.videoUrl && r.timestamp)
    .sort((a, b) => (b.videoPlayCount || 0) - (a.videoPlayCount || 0));
  if (!usable.length) throw new Error(`no reels found for @${creator}`);

  const top = usable[0];
  console.log(`top reel: ${(top.videoPlayCount || 0).toLocaleString()} views - ${top.url}`);

  const res = await fetch(top.videoUrl);
  if (!res.ok) throw new Error(`video download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  console.log("uploading to Gemini ...");
  const file = await uploadVideo(buf, res.headers.get("content-type") || "video/mp4");
  console.log("analysing ...");
  return analyzeVideo(file.uri, file.mimeType, analysisInstruction);
}

async function main() {
  preflight();

  const configs = readCsv("configs.csv");
  const wantConfig = arg("config");
  const conceptIndex = parseInt(arg("concept") ?? "1", 10) - 1;

  let analysis: string;
  let configName: string;

  if (has("live")) {
    const creator = arg("creator");
    if (!creator) throw new Error("--live requires --creator <username>");
    configName = wantConfig ?? configs[0].configName;
    const cfg = configs.find((c) => c.configName === configName);
    if (!cfg) throw new Error(`config not found: ${configName}`);
    analysis = await getAnalysisLive(creator, cfg.analysisInstruction);
  } else {
    const picked = await getAnalysisFromCsv(wantConfig);
    analysis = picked.analysis;
    configName = picked.configName;
  }

  const cfg = configs.find((c) => c.configName === configName);
  if (!cfg) throw new Error(`config not found: ${configName}`);
  console.log(`config: ${cfg.configName}\n`);

  console.log("generating concepts ...");
  const gen = await generateConcepts({
    brief: cfg.newConceptsInstruction,
    referenceAnalysis: analysis,
    renderMode: "stills",
  });

  console.log(`\n  sufficiency : ${gen.sufficiency}`);
  console.log(`  confidence  : ${gen.confidence}`);
  console.log(`  production  : ${gen.productionRecommended}`);
  console.log(`  concepts    : ${gen.concepts.length}`);
  if (gen.blockers.length) console.log(`  blockers    : ${gen.blockers.join(" | ")}`);
  if (gen.ambiguities.length) console.log(`  ambiguities : ${gen.ambiguities.join(" | ").slice(0, 300)}`);

  gen.concepts.forEach((c: VideoConcept, i: number) => {
    const total = c.scenes.reduce((s: number, x: { durationSec: number }) => s + x.durationSec, 0);
    console.log(`   ${i + 1}. ${c.title}  [${c.scenes.length} scenes, ${total}s]  "${c.hook}"`);
  });

  const gate = gateCheck(gen);
  console.log(`\n  GATE: ${gate.pass ? "PASS" : "BLOCKED - " + gate.reason}`);
  if (!gate.pass) {
    console.log("\nNothing rendered, nothing spent. This is a correct outcome.\n");
    return;
  }
  if (has("dry")) {
    console.log("\n--dry set, stopping before render.\n");
    return;
  }

  const slug = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${cfg.configName.replace(/\W+/g, "-").toLowerCase()}`;
  const outDir = path.join(OUT_ROOT, slug);

  console.log(`\nproducing concept ${conceptIndex + 1} -> ${outDir}\n`);
  const result = await produceReel({
    generation: gen,
    conceptIndex,
    outDir,
    onProgress: (s) => console.log("   ·", s),
  });

  if (result.status === "blocked") {
    console.log(`\nBLOCKED: ${result.reason}\n`);
    return;
  }

  console.log("\n" + "=".repeat(60));
  console.log("REEL READY");
  console.log("=".repeat(60));
  console.log(`  file     : ${result.videoPath}`);
  console.log(`  duration : ${result.durationSec?.toFixed(2)}s`);
  console.log(`  caption  : ${result.caption}`);
  console.log(`  hashtags : ${result.hashtags?.map((h) => "#" + h).join(" ")}`);
  console.log(`\n  open it:  start "" "${result.videoPath}"\n`);
}

main().catch((e) => {
  console.error("\nFAILED:", e.message, "\n");
  process.exit(1);
});
