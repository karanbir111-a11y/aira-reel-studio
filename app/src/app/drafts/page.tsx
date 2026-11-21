"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DraftSummary } from "@/lib/types";

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  function load() {
    fetch("/api/drafts")
      .then((r) => r.json())
      .then((d: DraftSummary[]) => setDrafts(Array.isArray(d) ? d : []))
      .catch(() => setError("Could not load drafts"))
      .finally(() => setLoading(false));
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Delete the saved prompts for "${title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/drafts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Drafts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every Flow package this app has built, with its prompts. Rendering in Flow takes
          long enough that the app will often reload in the middle of it, so the prompts live
          on disk rather than in the page.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : drafts.length === 0 ? (
        <Card className="p-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            Nothing saved yet. A draft is written the moment you build a Flow package on the
            Create page.
          </p>
          <Button asChild size="sm">
            <Link href="/create">Create a reel</Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <Card key={d.id} className="p-4 flex items-center gap-4">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <Link href={`/drafts/${d.id}`} className="text-sm font-medium hover:underline">
                  {d.title}
                </Link>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(d.updatedAt).toLocaleString()}
                  {d.configName ? ` · ${d.configName}` : ""} · {d.id}
                </p>
              </div>
              <Badge variant={d.renderedCount === d.shotCount ? "default" : "secondary"}>
                {d.renderedCount}/{d.shotCount} rendered
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => remove(d.id, d.title)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
