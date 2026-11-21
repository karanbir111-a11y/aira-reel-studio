"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Film,
  Play,
  Users,
  Settings2,
  Wand2,
  Clapperboard,
  Palette,
  UserRound,
  FileText,
  Combine,
  Eye,
  EyeOff,
  SlidersHorizontal,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";

/**
 * Grouped rather than one flat list, because nine undifferentiated links read
 * as clutter even when every one of them is wanted. Making a reel, looking at
 * what has been made, and configuring the thing are three different jobs.
 */
const navGroups: {
  label: string;
  items: { title: string; href: string; icon: typeof Film }[];
}[] = [
  {
    label: "Make",
    items: [
      { title: "Create", href: "/create", icon: Wand2 },
      { title: "Drafts", href: "/drafts", icon: FileText },
      { title: "Assemble", href: "/assemble", icon: Combine },
    ],
  },
  {
    label: "Library",
    items: [
      { title: "Reels", href: "/reels", icon: Clapperboard },
      { title: "Videos", href: "/videos", icon: Film },
      { title: "Creators", href: "/creators", icon: Users },
    ],
  },
  {
    label: "Setup",
    items: [
      { title: "Run Pipeline", href: "/run", icon: Play },
      { title: "Configs", href: "/configs", icon: Settings2 },
      { title: "Brand", href: "/brand", icon: Palette },
      { title: "Character", href: "/character", icon: UserRound },
    ],
  },
];

const STORAGE_KEY = "sidebar-hidden";

/** Create is the entry point to everything, so it is not hideable. */
const ALWAYS_SHOWN = "/create";

/**
 * Which items are hidden is kept in a module-level store read through
 * useSyncExternalStore, rather than state loaded from an effect.
 *
 * The server has no localStorage, so an effect that loads it has to set state
 * after mount, which renders the wrong menu for one frame. getServerSnapshot
 * returns the same empty list the server markup was built from, so hydration
 * matches; getSnapshot caches the parsed array because React re-renders
 * forever if it returns a fresh reference each call.
 */
const NONE_HIDDEN: string[] = [];

let hiddenCache: string[] = NONE_HIDDEN;
let hiddenRaw: string | null = null;
const hiddenListeners = new Set<() => void>();

function readHidden(): string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked or unavailable store just means nothing is hidden.
    return NONE_HIDDEN;
  }
  if (raw !== hiddenRaw) {
    hiddenRaw = raw;
    try {
      const parsed = raw ? JSON.parse(raw) : NONE_HIDDEN;
      hiddenCache = Array.isArray(parsed) ? parsed : NONE_HIDDEN;
    } catch {
      hiddenCache = NONE_HIDDEN;
    }
  }
  return hiddenCache;
}

function writeHidden(next: string[]) {
  hiddenCache = next;
  hiddenRaw = JSON.stringify(next);
  try {
    localStorage.setItem(STORAGE_KEY, hiddenRaw);
  } catch {
    // Not persisting is survivable - the change still applies this session.
  }
  hiddenListeners.forEach((notify) => notify());
}

function subscribeHidden(onChange: () => void) {
  hiddenListeners.add(onChange);
  // Another tab customising the menu should update this one too.
  window.addEventListener("storage", onChange);
  return () => {
    hiddenListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function AppSidebar() {
  const pathname = usePathname();
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [customising, setCustomising] = useState(false);
  const hidden = useSyncExternalStore(subscribeHidden, readHidden, () => NONE_HIDDEN);

  useEffect(() => {
    fetch("/api/videos")
      .then((r) => r.json())
      .then((videos: { dateAdded: string }[]) => {
        if (videos.length > 0 && videos[0].dateAdded) {
          setLastRun(videos[0].dateAdded);
        }
      })
      .catch(() => {});
  }, []);

  function toggle(href: string) {
    if (href === ALWAYS_SHOWN) return;
    writeHidden(
      hidden.includes(href) ? hidden.filter((h) => h !== href) : [...hidden, href]
    );
  }

  return (
    <Sidebar className="border-r border-white/[0.06]">
      <SidebarHeader className="px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 glow-sm">
            <Film className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">Virality System</h1>
            <p className="text-[11px] text-muted-foreground">Instagram Reels AI</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3">
        {navGroups.map((group) => {
          // While customising, every item shows so hidden ones can be brought
          // back; otherwise a hidden item has no way back into the list.
          const items = customising
            ? group.items
            : group.items.filter((i) => !hidden.includes(i.href));
          if (items.length === 0) return null;

          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-[11px]">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    // startsWith so a detail route such as /drafts/<id> still
                    // highlights the section it belongs to.
                    const isActive =
                      pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const isHidden = hidden.includes(item.href);

                    return (
                      <SidebarMenuItem key={item.href}>
                        {customising ? (
                          <SidebarMenuButton
                            className="h-10 rounded-xl px-3"
                            onClick={() => toggle(item.href)}
                            disabled={item.href === ALWAYS_SHOWN}
                          >
                            {isHidden ? (
                              <EyeOff className="h-4 w-4 opacity-40" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                            <span
                              className={`text-[13px] ${isHidden ? "opacity-40 line-through" : ""}`}
                            >
                              {item.title}
                            </span>
                          </SidebarMenuButton>
                        ) : (
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            className="h-10 rounded-xl px-3 transition-all duration-200"
                          >
                            <Link href={item.href}>
                              <item.icon className="h-4 w-4" />
                              <span className="text-[13px]">{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="px-3 py-4 space-y-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-9 rounded-xl px-3 text-muted-foreground"
              onClick={() => setCustomising((v) => !v)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="text-[13px]">
                {customising ? "Done" : "Customise menu"}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {customising ? (
          <p className="px-3 text-[11px] text-muted-foreground">
            Tap an item to hide or show it. Saved in this browser.
          </p>
        ) : (
          lastRun && (
            <p className="px-3 text-[11px] text-muted-foreground">
              Last pipeline: <span className="text-foreground/70">{lastRun}</span>
            </p>
          )
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
