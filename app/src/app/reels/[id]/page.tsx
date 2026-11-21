"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Check, Copy, Download, Loader2, Music, RefreshCw, Save, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Reel } from "@/lib/types";

async function readStream(res: Response, onEvent: (e: Record<string, unknown>) => void) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        /* partial frame */
      }
    }
  }
}

export default function ReelStudioPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [reel, setReel] = useState<Reel | null>(null);
  const [tracks, setTracks] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [script, setScript] = useState("");
  const [music, setMusic] = useState("");
  const [scenePrompts, setScenePrompts] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState("");
  const [bust, setBust] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/reels?id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Reel not found"))))
      .then((r: Reel) => {
        setReel(r);
        setCaption(r.caption);
        setHashtags(r.hashtags.join(" "));
        setScript(r.voiceoverScript);
        setMusic(r.musicUsed);
        setScenePrompts(r.scenes.map((s) => s.visualPrompt));
      })
      .catch((e) => setError(e.message));
    fetch("/api/music").then((r) => r.json()).then(setTracks).catch(() => {});
  }, [id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [steps]);

  const tagList = hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, "")).filter(Boolean);

  async function saveText(status?: Reel["status"]) {
    setError("");
    const res = await fetch("/api/reels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, caption, hashtags: tagList, status }),
    });
    if (!res.ok) return setError("Could not save");
    setReel(await res.json());
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function rebuild(payload: Record<string, unknown>) {
    setBusy(true);
    setSteps([]);
    setError("");
    try {
      const res = await fetch("/api/reels/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...payload }),
      });
      await readStream(res, (e) => {
        if (e.type === "step") setSteps((s) => [...s, String(e.text)]);
        if (e.type === "error") setError(String(e.message));
        if (e.type === "done") {
          setReel(e.reel as Reel);
          setBust(Number(e.cacheBust) || Date.now());
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1800);
  }

  if (error && !reel) return <Card className="p-6 text-sm">{error}</Card>;
  if (!reel) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const videoSrc = bust ? `${reel.videoUrl}?v=${bust}` : reel.videoUrl;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/reels")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{reel.title}</h1>
            <p className="text-xs text-muted-foreground">
              {reel.durationSec.toFixed(1)}s · {reel.renderMode} · {reel.status}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await fetch(`/api/reels?id=${id}`, { method: "DELETE" });
            router.push("/reels");
          }}
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          Delete
        </Button>
      </div>

      {error && <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</Card>}

      {busy && (
        <Card className="p-4">
          <div ref={logRef} className="max-h-40 overflow-auto space-y-1 font-mono text-xs">
            {steps.map((s, i) => (
              <div key={i} className="text-muted-foreground">
                <span className="text-primary mr-2">·</span>{s}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <video src={videoSrc} controls playsInline className="w-full rounded-xl border border-border" />
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={videoSrc} download={`${reel.title}.mp4`}>
              <Download className="h-4 w-4 mr-1.5" />
              Download video
            </a>
          </Button>
        </div>

        <div className="space-y-4">
          {/* ---- Instagram post composer ---- */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-sm">Instagram post</h2>
              {saved && <span className="text-xs text-primary flex items-center gap-1"><Check className="h-3 w-3" /> saved</span>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="caption">Caption</Label>
              <Textarea id="caption" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Hashtags</Label>
              <Textarea id="tags" rows={2} value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
              <p className="text-xs text-muted-foreground">{tagList.length} tags</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => saveText()}>
                <Save className="h-4 w-4 mr-1.5" />Save
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => copy(`${caption}\n\n${tagList.map((h) => `#${h}`).join(" ")}`, "all")}>
                <Copy className="h-4 w-4 mr-1.5" />
                {copied === "all" ? "Copied" : "Copy caption + tags"}
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => copy(caption, "cap")}>
                {copied === "cap" ? "Copied" : "Caption only"}
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => copy(tagList.map((h) => `#${h}`).join(" "), "tags")}>
                {copied === "tags" ? "Copied" : "Tags for first comment"}
              </Button>
            </div>

            <div className="flex gap-2 pt-1">
              <Button size="sm" variant={reel.status === "approved" ? "default" : "outline"}
                onClick={() => saveText("approved")}>
                Mark approved
              </Button>
              <Button size="sm" variant={reel.status === "posted" ? "default" : "outline"}
                onClick={() => saveText("posted")}>
                Mark posted
              </Button>
            </div>
          </Card>

          {/* ---- free edits ---- */}
          <Card className="p-5 space-y-4">
            <h2 className="font-medium text-sm">Edit the video</h2>
            <p className="text-xs text-muted-foreground">
              Music, captions and voiceover rebuild from the clips already on disk — no generation cost.
            </p>

            <div className="space-y-2">
              <Label>Music</Label>
              <div className="flex gap-2">
                <Select value={music} onValueChange={setMusic} disabled={busy}>
                  <SelectTrigger><SelectValue placeholder="No music" /></SelectTrigger>
                  <SelectContent>
                    {tracks.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={busy || !music}
                  onClick={() => rebuild({ musicFile: music })}>
                  <Music className="h-4 w-4 mr-1.5" />Apply
                </Button>
              </div>
              {tracks.length === 0 && (
                <p className="text-xs text-muted-foreground">No tracks — add files to /music</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Voiceover script</Label>
              <Textarea rows={4} value={script} onChange={(e) => setScript(e.target.value)} disabled={busy} />
              <Button size="sm" variant="outline" disabled={busy || script === reel.voiceoverScript}
                onClick={() => rebuild({ voiceoverScript: script, musicFile: music })}>
                <RefreshCw className="h-4 w-4 mr-1.5" />Re-record and rebuild
              </Button>
            </div>
          </Card>

          {/* ---- paid edits ---- */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-sm">Shots</h2>
              <Badge variant="secondary">~$0.96 per re-roll</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Regenerate one shot without touching the others. Edit the prompt first to steer it.
            </p>

            {scenePrompts.map((prompt, i) => (
              <div key={i} className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0">
                <Label>Shot {i + 1}</Label>
                <Textarea
                  rows={3}
                  value={prompt}
                  disabled={busy}
                  onChange={(e) =>
                    setScenePrompts((p) => p.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => rebuild({ rerollIndex: i, prompt, musicFile: music })}>
                  {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                  Re-roll shot {i + 1}
                </Button>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
