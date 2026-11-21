"use client";

import { useEffect, useState } from "react";
import { Check, Lock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CharacterIdentity } from "@/lib/character";

interface Loaded extends CharacterIdentity {
  referenceImages: string[];
}

const FIELDS: {
  key: keyof Omit<CharacterIdentity, "updatedAt" | "name">;
  label: string;
  hint: string;
}[] = [
  {
    key: "appearance",
    label: "Appearance",
    hint: "Face, hair, skin tone, build. Stated identically in every prompt so she never drifts.",
  },
  {
    key: "distinguishingMarks",
    label: "Distinguishing marks",
    hint: "Reference images reliably lose fine detail, so anything small must be written here to survive. Leave it empty if she has no such marks — naming one she does not have makes the renderer add it.",
  },
  {
    key: "voice",
    label: "Voice",
    hint: "Timbre, pitch, accent. Locked across every scene; only pace and expressiveness vary.",
  },
  {
    key: "speakingStyle",
    label: "Speaking style",
    hint: "Language mix, rhythm, register. How she talks, not what she says.",
  },
];

export default function CharacterPage() {
  const [character, setCharacter] = useState<Loaded | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/character")
      .then((r) => r.json())
      .then(setCharacter)
      .catch(() => setError("Could not load character"));
  }, []);

  async function save() {
    if (!character) return;
    setError("");
    const res = await fetch("/api/character", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(character),
    });
    if (!res.ok) return setError("Could not save");
    const next = await res.json();
    setCharacter({ ...next, referenceImages: character.referenceImages });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Character</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your persona&apos;s fixed identity. Written once and injected into every image and
          video prompt — this is what stops her changing between reels.
        </p>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</Card>
      )}

      {!character && <p className="text-sm text-muted-foreground">Loading…</p>}

      {character && (
        <>
          {character.referenceImages.length > 0 && (
            <Card className="p-4">
              <Label className="mb-3 block">Reference images</Label>
              <div className="flex gap-3">
                {character.referenceImages.map((src) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={src}
                    src={src}
                    alt=""
                    className="h-36 w-28 object-cover rounded-lg border border-border"
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                From <code>character/refs/</code>. Replace the files there to change her face.
              </p>
            </Card>
          )}

          <Card className="p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={character.name}
                onChange={(e) => setCharacter({ ...character, name: e.target.value })}
              />
            </div>

            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-2">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Textarea
                  id={f.key}
                  rows={3}
                  value={character[f.key] ?? ""}
                  onChange={(e) => setCharacter({ ...character, [f.key]: e.target.value })}
                />
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
              {character.updatedAt && (
                <span className="text-xs text-muted-foreground ml-auto">
                  updated {new Date(character.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </Card>

          <Card className="p-5 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4" />
              What gets locked on every generation
            </div>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
              <li>Her face, skin tone, proportions and hair — no substitution, no drift</li>
              <li>Any product&apos;s exact colours, pattern, lettering and branding — no redesign</li>
              <li>Her voice identity, pitch and accent — only pace and expressiveness vary</li>
              <li>No extra props, no subtitles, no scene cuts inside a shot</li>
              <li>Location, lighting and outfit stay identical across scenes unless the story needs otherwise</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
