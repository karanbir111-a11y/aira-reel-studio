"use client";

import { useEffect, useState } from "react";
import { Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BrandProfile } from "@/lib/types";

const FIELDS: {
  key: keyof Omit<BrandProfile, "updatedAt">;
  label: string;
  hint: string;
  rows?: number;
}[] = [
  { key: "brandName", label: "Brand name", hint: "Who the content is for." },
  {
    key: "about",
    label: "About",
    hint: "What the brand does and what it stands for.",
    rows: 3,
  },
  {
    key: "audience",
    label: "Audience",
    hint: "Who is watching. Age, place, what they care about.",
    rows: 2,
  },
  {
    key: "toneRules",
    label: "Tone rules",
    hint: "How it should sound. Calm and factual, playful, blunt.",
    rows: 3,
  },
  {
    key: "alwaysEnsure",
    label: "Always ensure",
    hint: "Things every reel must do. Mention the fabric, end on a question, show the price.",
    rows: 3,
  },
  {
    key: "alwaysAvoid",
    label: "Always avoid",
    hint: "Words, claims or angles that are off-limits, every time.",
    rows: 3,
  },
];

export default function BrandPage() {
  const [brand, setBrand] = useState<BrandProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/brand")
      .then((r) => r.json())
      .then(setBrand)
      .catch(() => setError("Could not load brand profile"));
  }, []);

  async function save() {
    if (!brand) return;
    setError("");
    const res = await fetch("/api/brand", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brand),
    });
    if (!res.ok) return setError("Could not save");
    setBrand(await res.json());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const filled = brand
    ? FIELDS.filter((f) => (brand[f.key] ?? "").trim()).length
    : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brand profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Applied to every reel, on top of whichever config you pick. Entirely optional —
          leave it blank and nothing changes.
        </p>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</Card>
      )}

      {!brand && <p className="text-sm text-muted-foreground">Loading…</p>}

      {brand && (
        <Card className="p-6 space-y-5">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label htmlFor={f.key}>{f.label}</Label>
              {f.rows ? (
                <Textarea
                  id={f.key}
                  rows={f.rows}
                  value={brand[f.key] ?? ""}
                  onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value })}
                />
              ) : (
                <Input
                  id={f.key}
                  value={brand[f.key] ?? ""}
                  onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value })}
                />
              )}
              <p className="text-xs text-muted-foreground">{f.hint}</p>
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={save}>
              <Save className="h-4 w-4 mr-1.5" />
              Save
            </Button>
            {saved && (
              <span className="text-xs text-primary flex items-center gap-1">
                <Check className="h-3 w-3" /> saved
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {filled} of {FIELDS.length} filled
              {brand.updatedAt &&
                ` · updated ${new Date(brand.updatedAt).toLocaleDateString()}`}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
