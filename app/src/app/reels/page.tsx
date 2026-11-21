"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clapperboard, Wand2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Reel } from "@/lib/types";

const STATUS_VARIANT: Record<Reel["status"], "secondary" | "default" | "outline"> = {
  draft: "secondary",
  approved: "default",
  posted: "outline",
};

export default function ReelsPage() {
  const [reels, setReels] = useState<Reel[] | null>(null);

  useEffect(() => {
    fetch("/api/reels")
      .then((r) => r.json())
      .then(setReels)
      .catch(() => setReels([]));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything you&apos;ve produced. Click one to edit or post it.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/create">
            <Wand2 className="h-4 w-4 mr-1.5" />
            Create
          </Link>
        </Button>
      </div>

      {reels === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {reels?.length === 0 && (
        <Card className="p-10 text-center">
          <Clapperboard className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No reels yet. Make your first one on the Create page.
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/create">Create a reel</Link>
          </Button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reels?.map((reel) => (
          <Link key={reel.id} href={`/reels/${reel.id}`}>
            <Card className="overflow-hidden hover:border-foreground/20 transition-colors h-full">
              <video
                src={reel.videoUrl}
                muted
                playsInline
                preload="metadata"
                className="w-full aspect-[9/16] object-cover bg-muted"
                onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                onMouseLeave={(e) => {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = 0;
                }}
              />
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium line-clamp-1">{reel.title}</span>
                  <Badge variant={STATUS_VARIANT[reel.status]} className="shrink-0">
                    {reel.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{reel.hook}</p>
                <p className="text-xs text-muted-foreground">
                  {reel.durationSec.toFixed(0)}s · {reel.renderMode} ·{" "}
                  {new Date(reel.createdAt).toLocaleDateString()}
                </p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
