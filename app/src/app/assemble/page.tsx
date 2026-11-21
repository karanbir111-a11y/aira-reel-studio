"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Clapperboard, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Draft, DraftSummary } from "@/lib/types";

interface Result {
  id: string;
  videoUrl: string;
  durationSec: number;
  clipCount: number;
  musicUsed: string;
}

const NO_DRAFT = "__none__";

/**
 * Stitching clips is the one step that needs no concept, no API and no money -
 * it is local ffmpeg over files the operator already has. So it gets its own
 * page rather than living at the end of the create funnel, which previously had
 * to be walked from the top to reach it.
 */
export default function AssemblePage() {
  const searchParams = useSearchParams();

  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftId, setDraftId] = useState(NO_DRAFT);
  const [draft, setDraft] = useState<Draft | null>(null);

  const [clips, setClips] = useState<(File | null)[]>([null, null, null]);
  const [script, setScript] = useState("");
  const [musicMood, setMusicMood] = useState("");
  const [burnCaptions, setBurnCaptions] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetch("/api/drafts")
      .then((r) => r.json())
      .then((d: DraftSummary[]) => setDrafts(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Arriving from a draft page preselects that draft.
  useEffect(() => {
    const fromUrl = searchParams.get("draft");
    if (fromUrl) setDraftId(fromUrl);
  }, [searchParams]);

  useEffect(() => {
    if (draftId === NO_DRAFT) {
      setDraft(null);
      return;
    }
    fetch(`/api/drafts?id=${encodeURIComponent(draftId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Draft | null) => {
        if (!d) return;
        setDraft(d);
        setScript(d.concept.voiceoverScript ?? "");
        setMusicMood(d.concept.musicMood ?? "");
        setClips(Array.from({ length: d.concept.scenes.length }, () => null));
      })
      .catch(() => setError("Could not load that draft"));
  }, [draftId]);

  function setClipAt(index: number, file: File | null) {
    setClips((prev) => prev.map((c, i) => (i === index ? file : c)));
  }

  async function assemble() {
    const files = clips.filter((f): f is File => Boolean(f));
    if (files.length === 0) {
      setError("Add at least one clip.");
      return;
    }
    if (files.length !== clips.length) {
      setError("Every slot needs a clip, or remove the empty ones.");
      return;
    }

    setError("");
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      clips.forEach((file, i) => file && form.append(`clip${i}`, file));
      form.append("script", script);
      form.append("musicMood", musicMood);
      form.append("captions", burnCaptions ? "true" : "false");
      if (draft) form.append("draftId", draft.id);

      const res = await fetch("/api/assemble", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assembly failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Assemble</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Stitch clips you rendered in Flow into one reel. Each clip keeps its own audio, so
          her voice and lip sync survive; the music bed sits underneath without stealing
          level. Runs ffmpeg locally and calls no API.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="space-y-2">
          <Label>Draft</Label>
          <Select value={draftId} onValueChange={setDraftId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a saved draft, or none" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DRAFT}>No draft — just stitch my files</SelectItem>
              {drafts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title} · {d.shotCount} shots
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Picking one fills in the caption script and music direction, and labels each slot
            with that shot&apos;s line. Without one, you can still stitch and burn in whatever
            script you paste below.
          </p>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Label>Clips, in order</Label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setClips((prev) => [...prev, null])}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add slot
            </Button>
            {clips.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setClips((prev) => prev.slice(0, -1))}
              >
                <X className="h-4 w-4 mr-1.5" />
                Remove last
              </Button>
            )}
          </div>
        </div>

        {clips.map((file, i) => {
          const line = draft?.concept.scenes[i]?.dialogue ?? "";
          return (
            <div key={i} className="space-y-1.5">
              <Label>
                Shot {i + 1}
                {line ? (
                  <span className="ml-2 font-normal text-muted-foreground">
                    &ldquo;{line.slice(0, 60)}
                    {line.length > 60 ? "…" : ""}&rdquo;
                  </span>
                ) : null}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept="video/*"
                  onChange={(e) => setClipAt(i, e.target.files?.[0] ?? null)}
                />
                {file && (
                  <Badge variant="secondary" className="shrink-0">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </Card>

      <Card className="p-5 space-y-4">
        <div className="space-y-2">
          <Label>Caption script</Label>
          <Textarea
            rows={3}
            placeholder="The spoken words, used to time the burned-in captions."
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Music direction</Label>
          <Input
            placeholder="e.g. upbeat playful pop"
            value={musicMood}
            onChange={(e) => setMusicMood(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave empty for no music bed.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={burnCaptions}
            onChange={(e) => setBurnCaptions(e.target.checked)}
          />
          Burn in captions from the script
        </label>

        <Button onClick={assemble} disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Clapperboard className="h-4 w-4 mr-1.5" />
          )}
          {busy ? "Assembling…" : "Assemble reel"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>

      {result && (
        <Card className="p-5 flex flex-col gap-5 sm:flex-row">
          <video
            src={result.videoUrl}
            controls
            playsInline
            className="w-full max-w-[260px] rounded-xl border border-border"
          />
          <div className="flex-1 space-y-3">
            <p className="text-sm">
              {result.clipCount} clips · {result.durationSec.toFixed(1)}s
              {result.musicUsed ? ` · music: ${result.musicUsed}` : " · no music"}
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button asChild size="sm" variant="outline">
                <a href={result.videoUrl} download>
                  Download
                </a>
              </Button>
              <Button asChild size="sm">
                <Link href={`/reels/${result.id}`}>Edit shots &amp; post</Link>
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
