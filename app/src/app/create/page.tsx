"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check, Clapperboard, Copy, Images, Loader2, Pencil, Plus, RefreshCw,
  Trash2, Upload, Wand2, X,
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
import {
  estimateConcepts, estimateStoryboard, estimateVideo, RATES, money,
} from "@/lib/cost";
import { FlowRunSheet } from "@/components/flow-run-sheet";
import type {
  Config, ConceptGeneration, VideoConcept, Draft, DraftShot, FlowPackage,
} from "@/lib/types";

type Stage =
  | "brief" | "working" | "concepts" | "storyboard" | "producing" | "result"
  | "flow";

interface ProductPreview {
  name: string;
  brand: string;
  price: string;
  colour: string;
  imageUrls: string[];
}
interface Shot {
  index: number;
  imageUrl: string;
  prompt: string;
}

interface Produced {
  id: string;
  videoUrl: string;
  caption: string;
  hashtags: string[];
  durationSec?: number;
  musicUsed?: string;
}

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

/** Select will not accept an empty value, so "no brief" needs a sentinel. */
const NO_CONFIG = "__none__";

const STEPS: { id: Stage; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "concepts", label: "Concepts" },
  { id: "storyboard", label: "Storyboard" },
  { id: "flow", label: "Flow package" },
];

export default function CreatePage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [configName, setConfigName] = useState("");
  const [references, setReferences] = useState<string[]>([""]);
  const [prompt, setPrompt] = useState("");
  const [productUrls, setProductUrls] = useState<string[]>([""]);
  const [products, setProducts] = useState<ProductPreview[]>([]);
  const [productBusy, setProductBusy] = useState(false);
  /** Local URLs under /products, mirrored from a listing or uploaded by hand. */
  const [productImages, setProductImages] = useState<string[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [targetSeconds, setTargetSeconds] = useState(30);
  const [speaking, setSpeaking] = useState(true);
  const [override, setOverride] = useState(false);

  const [stage, setStage] = useState<Stage>("brief");
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState("");

  const [generation, setGeneration] = useState<ConceptGeneration | null>(null);
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState(false);

  const [draftId, setDraftId] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [approved, setApproved] = useState<Record<number, boolean>>({});
  const [rerolling, setRerolling] = useState<number | null>(null);

  const [produced, setProduced] = useState<Produced | null>(null);
  const [flow, setFlow] = useState<FlowPackage | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);

  // Per-shot render progress, owned by the saved draft.
  const [draftShots, setDraftShots] = useState<Record<string, DraftShot>>({});
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/configs")
      .then((r) => r.json())
      .then((c: Config[]) => {
        setConfigs(c);
      })
      .catch(() => setError("Could not load configs"));
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [steps]);

  // The sentinel is a UI concern only; the API takes an empty string for
  // "no brief".
  const brief = configName === NO_CONFIG ? "" : configName;

  const busy = stage === "working" || stage === "producing";
  const liveRefs = references.filter((r) => r.trim());
  const concept = generation?.concepts[selected];
  const shotCount = concept?.scenes.length ?? 3;
  const allApproved = shots.length > 0 && shots.every((s) => approved[s.index]);

  const liveProductUrls = productUrls.filter((u) => u.trim());

  async function lookupProducts() {
    if (!liveProductUrls.length) return;
    setProductBusy(true);
    setError("");
    try {
      const res = await fetch("/api/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: liveProductUrls }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not read that page");
      setProducts(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProducts([]);
    } finally {
      setProductBusy(false);
    }
  }

  /**
   * Copies listing photographs into public/products.
   *
   * Mirrored rather than linked: retail CDN URLs expire, refuse hotlinks and
   * sit on another origin, which also blocks copying one to the clipboard for
   * pasting into Flow.
   */
  async function importListingImages() {
    const urls = products.flatMap((p) => (p.imageUrls ?? []).slice(0, 3));
    if (!urls.length) return;
    setImageBusy(true);
    setError("");
    try {
      const res = await fetch("/api/product-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not fetch those images");
      setProductImages((p) => [...p, ...data.images]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImageBusy(false);
    }
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    setImageBusy(true);
    setError("");
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append("files", file);
      const res = await fetch("/api/product-images", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not upload those images");
      setProductImages((p) => [...p, ...data.images]);
      if (data.failed?.length) setError(data.failed.join("; "));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImageBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  function removeProductImage(url: string) {
    setProductImages((p) => p.filter((u) => u !== url));
    // Best effort: the list is what the pipeline reads, so a file left behind
    // is wasted disk, not a wrong prompt.
    fetch(`/api/product-images?url=${encodeURIComponent(url)}`, { method: "DELETE" }).catch(
      () => {}
    );
  }

  async function runConcepts() {
    setError("");
    setSteps([]);
    setGeneration(null);
    setShots([]);
    setApproved({});
    setProduced(null);
    setDraftId("");
    setOverride(false);
    setStage("working");
    try {
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          references: liveRefs, prompt, productUrls: liveProductUrls, productImages,
          configName: brief, renderMode: "persona",
          targetSeconds, speaking,
        }),
      });
      await readStream(res, (e) => {
        if (e.type === "step") setSteps((s) => [...s, String(e.text)]);
        if (e.type === "products") setProducts(e.products as ProductPreview[]);
        if (e.type === "error") { setError(String(e.message)); setStage("brief"); }
        if (e.type === "done") {
          setGeneration(e.generation as ConceptGeneration);
          setSelected(0);
          setStage("concepts");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("brief");
    }
  }

  async function runStoryboard(shotIndex?: number, overridePrompt?: string) {
    if (!concept) return;
    setError("");
    setFlow(null);
    if (shotIndex === undefined) { setSteps([]); setStage("working"); }
    else setRerolling(shotIndex);

    try {
      const res = await fetch("/api/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept, productUrls: liveProductUrls, draftId: draftId || undefined, shotIndex, prompt: overridePrompt,
        }),
      });
      await readStream(res, (e) => {
        if (e.type === "step") setSteps((s) => [...s, String(e.text)]);
        if (e.type === "error") {
          setError(String(e.message));
          setStage(shotIndex === undefined ? "concepts" : "storyboard");
        }
        if (e.type === "done") {
          setDraftId(String(e.draftId));
          const fresh = e.shots as Shot[];
          setShots((prev) => {
            if (shotIndex === undefined) return fresh;
            return prev.map((s) =>
              s.index === shotIndex
                ? { ...fresh[0], imageUrl: `${fresh[0].imageUrl}?v=${Date.now()}` }
                : s
            );
          });
          if (shotIndex !== undefined) setApproved((a) => ({ ...a, [shotIndex]: false }));
          setStage("storyboard");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerolling(null);
    }
  }

  async function runProduce() {
    if (!generation) return;
    setError("");
    setSteps([]);
    setStage("producing");
    try {
      const res = await fetch("/api/produce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation, conceptIndex: selected, renderMode: "persona", configName: brief, draftId, override, productUrls: liveProductUrls,
          redact: products.flatMap((p) => [p.brand, ...p.brand.split(/s+/)]).filter(Boolean),
        }),
      });
      await readStream(res, (e) => {
        if (e.type === "step") setSteps((s) => [...s, String(e.text)]);
        if (e.type === "blocked") { setError(`Blocked: ${e.reason}`); setStage("storyboard"); }
        if (e.type === "error") { setError(String(e.message)); setStage("storyboard"); }
        if (e.type === "done") { setProduced(e as unknown as Produced); setStage("result"); }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("storyboard");
    }
  }

  async function buildFlow() {
    if (!concept) return;
    setFlowBusy(true);
    setError("");
    try {
      const res = await fetch("/api/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept, draftId: draftId || undefined, productUrls: liveProductUrls, productImages,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not build the package");
      const pkg: FlowPackage = await res.json();

      // Saved before the stage even renders. Rendering in Flow runs for long
      // enough that this page will often be reloaded in the middle of it, and
      // prompts held only in React state do not survive that.
      const saved = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draftId || undefined,
          title: concept.title,
          configName: brief,
          productUrls: liveProductUrls,
          productImages,
          targetSeconds,
          speaking,
          concept,
          flow: pkg,
        }),
      });
      if (!saved.ok) throw new Error((await saved.json()).error ?? "Could not save the draft");
      const draft: Draft = await saved.json();

      setDraftId(draft.id);
      setDraftShots(draft.shots);
      setFlow(draft.flow);
      setStage("flow");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFlowBusy(false);
    }
  }

  function updateConcept(patch: Partial<VideoConcept>) {
    if (!generation) return;
    setGeneration({
      ...generation,
      concepts: generation.concepts.map((c, i) => (i === selected ? { ...c, ...patch } : c)),
    });
  }

  const activeStep = stage === "working" || stage === "producing"
    ? stage === "producing" ? "storyboard" : "brief"
    : stage;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create a reel</h1>
        <div className="flex items-center gap-2 mt-3 text-xs">
          {STEPS.map((s, i) => {
            const idx = STEPS.findIndex((x) => x.id === activeStep);
            const state = i < idx ? "done" : i === idx ? "now" : "todo";
            return (
              <div key={s.id} className="flex items-center gap-2">
                <span
                  className={
                    state === "now"
                      ? "text-foreground font-medium"
                      : state === "done"
                        ? "text-primary"
                        : "text-muted-foreground"
                  }
                >
                  {state === "done" ? "✓ " : ""}{s.label}
                </span>
                {i < STEPS.length - 1 && <span className="text-muted-foreground">→</span>}
              </div>
            );
          })}
        </div>
      </div>

      {error && <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</Card>}

      {/* ---------------- 1. BRIEF ---------------- */}
      {stage === "brief" && (
        <Card className="p-6 space-y-6">
          <div className="space-y-2">
            <Label>Reference reels <span className="text-muted-foreground font-normal">(optional)</span></Label>
            {references.map((ref, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="me.sanvii  or  instagram.com/reel/ABC123"
                  value={ref}
                  onChange={(e) =>
                    setReferences((r) => r.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
                {references.length > 1 && (
                  <Button variant="ghost" size="icon"
                    onClick={() => setReferences((r) => r.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setReferences((r) => [...r, ""])}>
                <Plus className="h-4 w-4 mr-1.5" />Add another
              </Button>
              <span className="text-xs text-muted-foreground">
                A handle uses their top reel of the last 60 days. Each reference adds{" "}
                {money(RATES.videoAnalysis)} — one strong reference usually beats several.
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">Your direction <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="prompt" rows={3}
              placeholder="Make it about getting ready for a Navratri night out"
              value={prompt} onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Product links <span className="text-muted-foreground font-normal">(optional)</span></Label>
            {productUrls.map((url, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="https://www.myntra.com/..."
                  value={url}
                  onChange={(e) =>
                    setProductUrls((p) => p.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
                {productUrls.length > 1 && (
                  <Button variant="ghost" size="icon"
                    onClick={() => setProductUrls((p) => p.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setProductUrls((p) => [...p, ""])}>
                <Plus className="h-4 w-4 mr-1.5" />Add another
              </Button>
              <Button variant="outline" size="sm" onClick={lookupProducts}
                disabled={productBusy || !liveProductUrls.length}>
                {productBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch all"}
              </Button>
              {products.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  All are described in the script; the first is what she wears in the stills.
                </span>
              )}
            </div>

            {products.map((p, i) => (
              <Card key={i} className="p-3 flex gap-3 items-center mt-2">
                {p.imageUrls?.[0] && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.imageUrls[0]} alt="" className="h-16 w-12 object-cover rounded" />
                )}
                <div className="text-xs">
                  <div className="font-medium text-foreground">{p.name}</div>
                  <div className="text-muted-foreground">
                    {[p.brand, p.colour, p.price].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="ml-auto"
                  onClick={() => setProducts((v) => v.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            ))}
          </div>

          {/* ---------------- product reference images ---------------- */}
          <div className="space-y-2">
            <Label>
              Product reference images{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              A listing rarely states the neckline, sleeves, dupatta or embroidery placement,
              so without a photograph the renderer invents them — and the concept writer is
              right to flag that as a blocker. Attach the real item and that gap closes.
            </p>

            {productImages.length > 0 && (
              <div className="flex gap-2 flex-wrap pt-1">
                {productImages.map((url) => (
                  <div key={url} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="h-24 w-16 object-cover rounded border border-border"
                    />
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6"
                      onClick={() => removeProductImage(url)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={uploadRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                multiple
                className="hidden"
                onChange={(e) => uploadImages(e.target.files)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={imageBusy}
                onClick={() => uploadRef.current?.click()}
              >
                {imageBusy ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-1.5" />
                )}
                Upload images
              </Button>
              {products.some((p) => p.imageUrls?.length) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={imageBusy}
                  onClick={importListingImages}
                >
                  <Images className="h-4 w-4 mr-1.5" />
                  Use listing photos
                </Button>
              )}
              {productImages.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {productImages.length} attached — the run sheet hands{" "}
                  {productImages.length > 1 ? "them" : "it"} to you per shot.
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Length</Label>
              <Select value={String(targetSeconds)} onValueChange={(v) => setTargetSeconds(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20s — 2 shots</SelectItem>
                  <SelectItem value="30">30s — 3 shots</SelectItem>
                  <SelectItem value="40">40s — 4 shots</SelectItem>
                  <SelectItem value="50">50s — 5 shots</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Each shot is a fixed 10 seconds.</p>
            </div>
            <div className="space-y-2">
              <Label>Audio</Label>
              <Select value={speaking ? "speaks" : "voiceover"} onValueChange={(v) => setSpeaking(v === "speaks")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="speaks">She speaks to camera (lip-synced)</SelectItem>
                  <SelectItem value="voiceover">Voiceover over footage</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {speaking ? "Her voice is generated per shot and locked to her identity." : "A narrator track is laid over silent footage."}
              </p>
            </div>
          </div>

          <div className="space-y-2 max-w-sm">
            <Label>Client brief <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Select value={configName || NO_CONFIG} onValueChange={setConfigName}>
              <SelectTrigger><SelectValue placeholder="No client brief" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONFIG}>No client brief</SelectItem>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.configName}>{c.configName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Your <Link href="/brand" className="underline">brand profile</Link> is applied on top of this.
              {configName === NO_CONFIG || !configName
                ? " Without a brief, your direction below and the brand profile are the only brand input — expect lower confidence."
                : ""}
            </p>
          </div>

          <div className="flex items-center gap-3 border-t border-border pt-4">
            <Button onClick={runConcepts}
              disabled={
                !liveRefs.length && !prompt.trim() && !liveProductUrls.length &&
                !productImages.length
              }>
              <Wand2 className="h-4 w-4 mr-1.5" />Generate concepts
            </Button>
            <span className="text-xs text-muted-foreground">
              about {money(estimateConcepts(liveRefs.length))} · video is costed later, before you commit
            </span>
          </div>
        </Card>
      )}

      {/* ---------------- progress ---------------- */}
      {busy && (
        <Card className="p-4">
          <div ref={logRef} className="max-h-56 overflow-auto space-y-1 font-mono text-xs">
            {steps.map((s, i) => (
              <div key={i} className="text-muted-foreground">
                <span className="text-primary mr-2">·</span>{s}
              </div>
            ))}
            {steps.length === 0 && <div className="text-muted-foreground">Starting…</div>}
          </div>
          {stage === "producing" && (
            <p className="text-xs text-muted-foreground mt-3">
              Each shot takes 1–3 minutes to generate. Keep this tab open.
            </p>
          )}
        </Card>
      )}

      {/* ---------------- 2. CONCEPTS ---------------- */}
      {stage === "concepts" && generation && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-wrap items-center gap-3 text-sm">
            <Badge variant={generation.productionRecommended ? "default" : "destructive"}>
              {generation.productionRecommended ? "Gate passed" : "Blocked"}
            </Badge>
            <span className="text-muted-foreground">
              sufficiency <strong className="text-foreground">{generation.sufficiency}</strong>
            </span>
            <span className="text-muted-foreground">
              confidence <strong className="text-foreground">{generation.confidence}</strong>
            </span>
          </Card>

          {generation.blockers.length > 0 && (
            <Card className="p-4 border-destructive/40 text-sm space-y-1">
              <div className="font-medium">Blockers</div>
              {generation.blockers.map((b, i) => <div key={i} className="text-muted-foreground">• {b}</div>)}
              <div className="pt-2">
                <Button size="sm" variant={override ? "default" : "outline"} onClick={() => setOverride((o) => !o)}>
                  {override ? "Proceeding despite blockers" : "I've read these — proceed anyway"}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  The gate stops spending by default. Override once you have judged the blockers yourself.
                </p>
              </div>
            </Card>
          )}
          {generation.ambiguities.length > 0 && (
            <Card className="p-4 text-sm space-y-1">
              <div className="font-medium">Tensions it surfaced</div>
              {generation.ambiguities.map((a, i) => <div key={i} className="text-muted-foreground">• {a}</div>)}
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            {generation.concepts.map((c, i) => (
              <Card key={i} onClick={() => { setSelected(i); setEditing(false); }}
                className={`p-4 cursor-pointer transition-colors ${
                  i === selected ? "border-primary" : "hover:border-foreground/20"}`}>
                <div className="text-sm font-medium">{c.title}</div>
                <div className="text-xs text-muted-foreground mt-2 line-clamp-3">{c.hook}</div>
                <div className="text-xs text-muted-foreground mt-3">
                  {c.scenes.length} shots · {c.scenes.reduce((s, x) => s + x.durationSec, 0)}s
                </div>
              </Card>
            ))}
          </div>

          {concept && (
            <Card className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{concept.title}</h2>
                <Button variant="ghost" size="sm" onClick={() => setEditing((e) => !e)}>
                  <Pencil className="h-4 w-4 mr-1.5" />{editing ? "Done" : "Edit"}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Hook</Label>
                {editing
                  ? <Input value={concept.hook} onChange={(e) => updateConcept({ hook: e.target.value })} />
                  : <p className="text-sm">{concept.hook}</p>}
              </div>

              <div className="space-y-2">
                <Label>Voiceover</Label>
                {editing
                  ? <Textarea rows={4} value={concept.voiceoverScript}
                      onChange={(e) => updateConcept({ voiceoverScript: e.target.value })} />
                  : <p className="text-sm text-muted-foreground">{concept.voiceoverScript}</p>}
              </div>

              <div className="space-y-2">
                <Label>Shots</Label>
                {concept.scenes.map((s, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <Badge variant="secondary" className="mt-1 shrink-0">{s.durationSec}s</Badge>
                    {editing ? (
                      <Textarea rows={2} value={s.visualPrompt}
                        onChange={(e) =>
                          updateConcept({
                            scenes: concept.scenes.map((x, j) =>
                              j === i ? { ...x, visualPrompt: e.target.value } : x),
                          })} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{s.visualPrompt}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button onClick={buildFlow} disabled={flowBusy}>
                  {flowBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Copy className="h-4 w-4 mr-1.5" />}
                  Get Flow package
                </Button>
                <Button variant="outline" onClick={() => runStoryboard()}
                  disabled={!generation.productionRecommended && !override}>
                  <Images className="h-4 w-4 mr-1.5" />Build storyboard here
                </Button>
                <span className="text-xs text-muted-foreground">
                  Flow package is free · generating stills here costs{" "}
                  {money(estimateStoryboard(shotCount))}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setStage("brief")}>Back</Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ---------------- 3. STORYBOARD ---------------- */}
      {stage === "storyboard" && concept && (
        <div className="space-y-4">
          <Card className="p-4 text-sm">
            Approve every shot to unlock video. Regenerating a still costs{" "}
            {money(RATES.geminiImage)} — video costs {money(estimateVideo(1))} a shot, so fix it here.
          </Card>

          {generation && !generation.productionRecommended && (
            <Card className={`p-4 text-sm space-y-2 ${override ? "" : "border-destructive/40"}`}>
              <div className="font-medium">
                {override ? "Overriding the gate" : "The gate blocked this concept"}
              </div>
              {generation.blockers.map((b, i) => (
                <div key={i} className="text-muted-foreground text-xs">• {b}</div>
              ))}
              <Button
                size="sm"
                variant={override ? "default" : "outline"}
                onClick={() => setOverride((o) => !o)}
              >
                {override ? "Overriding — click to re-enable the gate" : "I've read these — proceed anyway"}
              </Button>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shots.map((shot) => (
              <Card key={shot.index} className={`overflow-hidden ${approved[shot.index] ? "border-primary" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.imageUrl} alt={`Shot ${shot.index + 1}`}
                  className="w-full aspect-[9/16] object-cover bg-muted" />
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Shot {shot.index + 1}</span>
                    {approved[shot.index] && (
                      <span className="text-xs text-primary flex items-center gap-1">
                        <Check className="h-3 w-3" />approved
                      </span>
                    )}
                  </div>
                  <Textarea rows={3} value={shot.prompt}
                    onChange={(e) =>
                      setShots((p) => p.map((s) =>
                        s.index === shot.index ? { ...s, prompt: e.target.value } : s))} />
                  <div className="flex gap-2">
                    <Button size="sm" variant={approved[shot.index] ? "outline" : "default"}
                      onClick={() => setApproved((a) => ({ ...a, [shot.index]: !a[shot.index] }))}>
                      {approved[shot.index] ? "Unapprove" : "Approve"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={rerolling !== null}
                      onClick={() => runStoryboard(shot.index, shot.prompt)}>
                      {rerolling === shot.index
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <RefreshCw className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card className="p-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={runProduce}
              disabled={!allApproved || (!!generation && !generation.productionRecommended && !override)}
            >
              <Clapperboard className="h-4 w-4 mr-1.5" />Animate here ({money(estimateVideo(shots.length))})
            </Button>
            <Button onClick={buildFlow} disabled={!allApproved || flowBusy}>
              {flowBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Copy className="h-4 w-4 mr-1.5" />}
              Get Flow package
            </Button>
            <span className="text-xs text-muted-foreground">
              {!allApproved
                ? `Approve all ${shots.length} shots to unlock`
                : "Flow package is free — prompts and stills to paste into Flow yourself"}
            </span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setStage("concepts")}>
              Back to concepts
            </Button>
          </Card>

        </div>
      )}

      {/* ---------------- FLOW PACKAGE ---------------- */}
      {stage === "flow" && flow && concept && (
        <div className="space-y-4">
          <FlowRunSheet
            flow={flow}
            concept={concept}
            draftId={draftId}
            shots={draftShots}
            onDraftChange={(d) => {
              setDraftShots(d.shots);
              setFlow(d.flow);
              updateConcept(d.concept);
            }}
          />

          <Card className="p-5 space-y-3">
            <h3 className="font-medium text-sm">Rendered the clips in Flow?</h3>
            <p className="text-xs text-muted-foreground">
              Assembly is its own page, so you can come back to it tomorrow without walking
              this funnel again. These prompts are saved as a draft either way.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button asChild>
                <Link href={`/assemble?draft=${draftId}`}>
                  <Clapperboard className="h-4 w-4 mr-1.5" />
                  Assemble my Flow clips
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/drafts/${draftId}`}>Open as draft</Link>
              </Button>
              <Button variant="ghost" onClick={() => setStage("concepts")}>
                Back to concepts
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ---------------- 4. RESULT ---------------- */}
      {stage === "result" && produced && (
        <Card className="p-6 space-y-5">
          <div className="flex flex-col gap-6 sm:flex-row">
            <video src={produced.videoUrl} controls playsInline
              className="w-full max-w-[260px] rounded-xl border border-border" />
            <div className="flex-1 space-y-4">
              <div>
                <Label>Caption</Label>
                <p className="text-sm whitespace-pre-wrap mt-1">{produced.caption}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {produced.hashtags?.map((h) => `#${h}`).join(" ")}
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button asChild size="sm">
                  <Link href={`/reels/${produced.id}`}>Edit shots &amp; post</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={produced.videoUrl} download>Download</a>
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
