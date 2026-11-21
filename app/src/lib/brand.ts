import fs from "fs";
import path from "path";
import type { BrandProfile } from "./types";

const FILE = path.join(process.cwd(), "..", "data", "brand.json");

export const EMPTY_BRAND: BrandProfile = {
  brandName: "",
  about: "",
  audience: "",
  toneRules: "",
  alwaysEnsure: "",
  alwaysAvoid: "",
  updatedAt: "",
};

export function readBrand(): BrandProfile {
  try {
    return { ...EMPTY_BRAND, ...JSON.parse(fs.readFileSync(FILE, "utf-8")) };
  } catch {
    return EMPTY_BRAND;
  }
}

export function writeBrand(profile: BrandProfile): BrandProfile {
  const next = { ...profile, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** Rendered into the prompt. Returns "" when nothing has been filled in. */
export function brandBlock(profile: BrandProfile): string {
  const lines = [
    profile.brandName && `Brand: ${profile.brandName}`,
    profile.about && `About: ${profile.about}`,
    profile.audience && `Audience: ${profile.audience}`,
    profile.toneRules && `Tone rules: ${profile.toneRules}`,
    profile.alwaysEnsure && `Always ensure: ${profile.alwaysEnsure}`,
    profile.alwaysAvoid && `Never do: ${profile.alwaysAvoid}`,
  ].filter(Boolean);

  return lines.length ? `# GLOBAL BRAND PROFILE\n\n${lines.join("\n")}` : "";
}
