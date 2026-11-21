"use client";

import { useState } from "react";
import {
  Check,
  Clipboard,
  Download,
  ExternalLink,
  ImageIcon,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import type { Draft, DraftShot, FlowPackage, VideoConcept } from "@/lib/types";

const FLOW_URL = "https://labs.google/fx/tools/flow";

interface Props {
  flow: FlowPackage;
  concept: VideoConcept;
  draftId: string;
  shots: Record<string, DraftShot>;
  /** Called whenever the server writes the draft, so the parent can re-render. */
  onDraftChange: (draft: Draft) => void;
}

/**
 * One shot at a time.
 *
 * The old layout stacked every shot on one page, which meant scrolling back
 * and forth between this tab and Flow while trying to remember which prompt
 * had already been pasted. Flow renders one shot per visit, so this does too.
 */
export function FlowRunSheet({ flow, concept, draftId, shots, onDraftChange }: Props) {
  const [active, setActive] = useState(0);
  const [showCharacter, setShowCharacter] = useState(false);
  const [copied, setCopied] = useState("");
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [revision, setRevision] = useState<{
    applied: boolean;
    notApplicableReason: string;
    changed: string[];
    otherShotsAffected: number[];
    continuityRisks: string[];
  } | null>(null);
  const [error, setError] = useState("");

  const shot = flow.shots[active];
  // Drafts saved before product references existed have no field here.
  const productImages = flow.productImageUrls ?? [];
  const rendered = Object.values(shots).filter((s) => s.rendered).length;
  const history = shots[String(active)]?.revisions ?? [];

  function flash(label: string) {
    setCopied(label);
    setTimeout(() => setCopied(""), 1800);
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    flash(label);
  }

  /**
   * Puts an image on the clipboard, so it can be pasted straight into Flow
   * instead of being downloaded and re-uploaded through a file picker. Needs
   * a secure context, which localhost counts as.
   */
  async function copyImage(url: string, label: string) {
    setError("");
    try {
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      flash(label);
    } catch {
      setError(
        "This browser would not take an image on the clipboard — download it instead."
      );
    }
  }

  async function saveShots(next: Record<string, DraftShot>) {
    setError("");
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId, concept, flow, shots: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save progress");
      onDraftChange(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleRendered(index: number) {
    const key = String(index);
    const current = shots[key];
    saveShots({
      ...shots,
      [key]: { rendered: !current?.rendered, revisions: current?.revisions ?? [] },
    });
  }

  async function revise() {
    if (!feedback.trim()) return;
    setRevising(true);
    setError("");
    setRevision(null);
    try {
      const res = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId, shotIndex: active, feedback }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revision failed");

      setRevision(data);
      if (data.saved) {
        onDraftChange(data.draft);
        setFeedback("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevising(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-medium text-sm">Flow run sheet</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rendered} of {flow.shots.length} shots rendered
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={FLOW_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1.5" />
                Open Flow
              </a>
            </Button>
            {flow.characterImageUrl && (
              <Button asChild size="sm" variant="outline">
                <a href={flow.characterImageUrl} download="character.png">
                  <Download className="h-4 w-4 mr-1.5" />
                  Character image
                </a>
              </Button>
            )}
          </div>
        </div>

        <Progress value={(rendered / Math.max(1, flow.shots.length)) * 100} />

        <div className="flex gap-2 flex-wrap">
          {flow.shots.map((s, i) => (
            <Button
              key={s.index}
              size="sm"
              variant={i === active ? "default" : "outline"}
              onClick={() => {
                setActive(i);
                setRevision(null);
                setFeedback("");
              }}
            >
              {shots[String(i)]?.rendered && <Check className="h-3.5 w-3.5 mr-1" />}
              Shot {i + 1}
            </Button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Attach the character image to every generation — Flow remembers nothing between
          them, and that is what makes her face drift. Her appearance and voice are already
          written into both prompts below, so the block here is a belt-and-braces extra
          rather than a required paste.
        </p>

        <div className="flex items-start gap-4">
          {flow.characterImageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={flow.characterImageUrl}
              alt=""
              className="h-24 w-16 object-cover rounded border border-border shrink-0"
            />
          )}
          <div className="flex-1 space-y-2">
            <Button size="sm" variant="ghost" onClick={() => setShowCharacter((v) => !v)}>
              {showCharacter ? "Hide" : "Show"} character block
            </Button>
            {showCharacter && (
              <>
                <Textarea
                  readOnly
                  rows={6}
                  value={flow.characterPrompt}
                  className="font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyText(flow.characterPrompt, "char")}
                >
                  <Clipboard className="h-4 w-4 mr-1.5" />
                  {copied === "char" ? "Copied" : "Copy character block"}
                </Button>
              </>
            )}
          </div>
        </div>

        {productImages.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <Label className="text-xs">
              Product reference — attach to every generation as well
            </Label>
            <p className="text-xs text-muted-foreground">
              The prompts tell Flow that these photographs, not the written description,
              decide the neckline, sleeves, hemline and print placement. Leave them out and
              it falls back to inventing those.
            </p>
            <div className="flex gap-2 flex-wrap pt-1">
              {productImages.map((url, i) => (
                <div key={url} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="h-28 w-20 object-cover rounded border border-border"
                  />
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      title="Copy to clipboard"
                      onClick={() => copyImage(url, `product${i}`)}
                    >
                      {copied === `product${i}` ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button asChild size="icon" variant="ghost" className="h-7 w-7">
                      <a href={url} download={`product${i + 1}`} title="Download">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {flow.removedTerms.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Brand names removed: {flow.removedTerms.join(", ")} — generators refuse real
            people&apos;s names, and many brands carry a founder&apos;s.
          </p>
        )}
        {flow.respellings.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Hindi respelled for speech:{" "}
            {flow.respellings.map((r) => `${r.from} → ${r.to}`).join(", ")} — captions still
            use the readable spelling.
          </p>
        )}
      </Card>

      {shot && (
        <Card className="p-5 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-medium text-sm">
              Shot {active + 1} of {flow.shots.length}
            </h3>
            <div className="flex items-center gap-2">
              {history.length > 0 && (
                <Badge variant="secondary">
                  {history.length} revision{history.length > 1 ? "s" : ""}
                </Badge>
              )}
              <Button
                size="sm"
                variant={shots[String(active)]?.rendered ? "default" : "outline"}
                onClick={() => toggleRendered(active)}
              >
                <Check className="h-4 w-4 mr-1.5" />
                {shots[String(active)]?.rendered ? "Rendered" : "Mark rendered"}
              </Button>
            </div>
          </div>

          {shot.dialogue && (
            <p className="text-xs text-muted-foreground italic">
              She says: &ldquo;{shot.dialogue}&rdquo;
            </p>
          )}

          <div className="flex gap-4 items-start flex-wrap">
            {shot.imageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={shot.imageUrl}
                alt=""
                className="h-40 w-28 object-cover rounded border border-border"
              />
            )}
            <div className="flex-1 min-w-[260px] space-y-5">
              <div className="space-y-2">
                <Label>
                  Step 1 — the still {shot.imageUrl ? "(already generated here)" : ""}
                </Label>
                <Textarea readOnly rows={5} value={shot.imagePrompt} className="font-mono text-xs" />
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyText(shot.imagePrompt, "img")}
                  >
                    <Clipboard className="h-4 w-4 mr-1.5" />
                    {copied === "img" ? "Copied" : "Copy image prompt"}
                  </Button>
                  {shot.imageUrl && (
                    <>
                      <Button size="sm" onClick={() => copyImage(shot.imageUrl!, "still")}>
                        <ImageIcon className="h-4 w-4 mr-1.5" />
                        {copied === "still" ? "Copied — paste in Flow" : "Copy still to clipboard"}
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <a href={shot.imageUrl} download={`shot${active + 1}.png`}>
                          <Download className="h-4 w-4 mr-1.5" />
                          Download still
                        </a>
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Step 2 — animate it</Label>
                <Textarea readOnly rows={6} value={shot.videoPrompt} className="font-mono text-xs" />
                <Button size="sm" onClick={() => copyText(shot.videoPrompt, "vid")}>
                  <Clipboard className="h-4 w-4 mr-1.5" />
                  {copied === "vid" ? "Copied" : "Copy video prompt"}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={active === 0}
              onClick={() => setActive(active - 1)}
            >
              Previous shot
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={active === flow.shots.length - 1}
              onClick={() => setActive(active + 1)}
            >
              Next shot
            </Button>
          </div>
        </Card>
      )}

      {/* ---------------- REVISE THIS SHOT ALONE ---------------- */}
      <Card className="p-5 space-y-3">
        <h3 className="font-medium text-sm">Shot {active + 1} came out wrong?</h3>
        <p className="text-xs text-muted-foreground">
          Say what to change and the prompts for this shot alone get rewritten. The other
          shots are treated as finished video and left untouched, so you re-render one clip
          rather than the reel. If the change cannot be contained to this shot, you are told
          instead of it being made.
        </p>
        <Textarea
          rows={3}
          placeholder="e.g. she is too far from the camera and the pose is stiff — bring her closer and have her hold the kurta up"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <Button onClick={revise} disabled={revising || !feedback.trim()}>
          {revising ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1.5" />
          )}
          {revising ? "Revising…" : `Revise shot ${active + 1}`}
        </Button>

        {revision && (
          <div className="space-y-2 pt-1 text-xs">
            {revision.applied ? (
              <>
                <p className="text-foreground">
                  Rewritten and saved. Re-render shot {active + 1} in Flow with the prompts
                  above.
                </p>
                {revision.changed.length > 0 && (
                  <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                    {revision.changed.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-destructive">
                Not applied — {revision.notApplicableReason}
              </p>
            )}
            {revision.otherShotsAffected.length > 0 && (
              <p className="text-destructive">
                Shots {revision.otherShotsAffected.join(", ")} would also need re-rendering
                for the reel to still cut together.
              </p>
            )}
            {revision.continuityRisks.length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                {revision.continuityRisks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="pt-1 space-y-1">
            <Label className="text-xs">Already asked for on this shot</Label>
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
              {history.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-2">
        <Label>Instagram caption</Label>
        <Textarea
          readOnly
          rows={4}
          value={`${flow.caption}\n\n${flow.hashtags.map((h) => `#${h}`).join(" ")}`}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            copyText(
              `${flow.caption}\n\n${flow.hashtags.map((h) => `#${h}`).join(" ")}`,
              "cap"
            )
          }
        >
          {copied === "cap" ? "Copied" : "Copy caption + tags"}
        </Button>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
