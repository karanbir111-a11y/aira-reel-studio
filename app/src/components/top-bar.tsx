"use client";

import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

const pageTitles: Record<string, string> = {
  "/videos": "Videos",
  "/run": "Run Pipeline",
  "/creators": "Creators",
  "/configs": "Configs",
};

export function TopBar() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "Virality System";
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur-xl">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
      <div className="h-4 w-px bg-border" />
      <span className="text-sm font-medium">{title}</span>

      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        className="ml-auto h-8 w-8 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
