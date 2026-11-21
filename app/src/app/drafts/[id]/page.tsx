"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FlowRunSheet } from "@/components/flow-run-sheet";
import type { Draft } from "@/lib/types";

export default function DraftPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/drafts?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Could not load this draft");
        return r.json();
      })
      .then(setDraft)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (error || !draft) {
    return (
      <Card className="p-6 space-y-3">
        <p className="text-sm text-destructive">{error || "Draft not found"}</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/drafts">Back to drafts</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link href="/drafts">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Drafts
            </Link>
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">{draft.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {draft.concept.scenes.length} shots · saved {new Date(draft.updatedAt).toLocaleString()}
            {draft.configName ? ` · ${draft.configName}` : ""}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/assemble?draft=${draft.id}`}>
            <Clapperboard className="h-4 w-4 mr-1.5" />
            Assemble clips
          </Link>
        </Button>
      </div>

      <FlowRunSheet
        flow={draft.flow}
        concept={draft.concept}
        draftId={draft.id}
        shots={draft.shots}
        onDraftChange={setDraft}
      />
    </div>
  );
}
