# Aira reel studio

A local Next.js app that turns a product link and a reference Instagram reel into a
vertical reel fronted by a consistent AI persona ("Aira") speaking Hinglish.

It does not render video by itself. It writes the concept, the shot list and the exact
prompts, and you paste those into Google Flow by hand. The app then assembles the clips
Flow gives you back into a finished reel with voiceover, music and captions.

Everything runs on your own machine against your own API keys. There is no hosted
version and no shared server.

## What you need first

| | |
|---|---|
| Node | 20.9 or newer. Next 16 will not start on older. (Developed on v24.) |
| ffmpeg | `ffmpeg` **and** `ffprobe` must both be on your PATH — the assembly step shells out to them. |
| API keys | Anthropic (required), Google AI Studio (required to render), Apify (optional). See below. |
| Disk | A few GB free. Rendered reels pile up fast. |

Installing ffmpeg:

```bash
# Windows
winget install Gyan.FFmpeg

# macOS
brew install ffmpeg

# Debian/Ubuntu
sudo apt install ffmpeg
```

Then confirm both are visible — if `ffprobe` is missing, assembly fails halfway with a
confusing error:

```bash
ffmpeg -version
ffprobe -version
```

## Setup

**1. Clone and install.** Dependencies live in `app/`, not at the repo root:

```bash
git clone <repo-url>
cd <repo-folder>/app
npm install
```

**2. Add your keys.** Copy `.env.example` to `.env` **in the repo root** (one level up
from `app/`) and fill it in:

```bash
cd ..
cp .env.example .env
```

| Variable | Needed for | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Writing concepts, revising shots | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `GEMINI_API_KEY` | Stills, video, voiceover audio | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `APIFY_API_TOKEN` | Pulling a reference reel off Instagram | [console.apify.com](https://console.apify.com/settings/integrations) |

Anthropic and Gemini are both pay-as-you-go. A concept run costs cents; video rendering
is the expensive part. Apify is optional — without it, every feature except the
Instagram reference field still works.

**3. Run it.** You must start the server from inside `app/`:

```bash
cd app
npm run dev
```

Then open http://localhost:3000.

### Why the directory matters

Every data path in the app resolves relative to the process's working directory and then
goes up one level — `path.join(process.cwd(), "..", "data")` and friends. Start the
server from the repo root instead of `app/` and it will look for `data/`, `music/` and
`character/refs/` outside the repo, find nothing, and fail in ways that do not point at
the cause. Always `cd app` first.

## Using it

| Page | What it is for |
|---|---|
| `/create` | The main flow. Paste a product URL and/or upload product photos, optionally a reference reel, and generate a concept plus the Flow prompts. |
| `/drafts` | Saved concepts. Open one to copy prompts shot by shot, tick off what you have rendered, and request revisions on a single shot. |
| `/assemble` | Upload the clips Flow produced and stitch them into the final reel. |
| `/character` | Aira's fixed identity — appearance, voice, speaking style. |
| `/brand` | Brand voice settings applied across concepts. |
| `/reels` | Finished reels. |
| `/creators`, `/videos`, `/configs` | Reference material scraped from Instagram and saved presets. |

The normal loop is: `/create` → copy the prompts → render each shot in Google Flow →
`/assemble` with the downloaded clips.

## Things worth knowing

**The persona is locked to one image.** `character/refs/ref0.png` is Aira's face. Prompts
tell the renderer to use it as her exact likeness, so replacing that file changes who she
is in every future reel. The discarded variants and pre-retouch originals are
deliberately not in this repo — a stray `ref*_mole.png` in `character/refs/` would get
picked up and quietly reintroduce a chin mark that was removed on purpose.

**Generated output is not in the repo.** `output/`, `app/public/reels/`,
`app/public/products/` and `app/public/character/` are gitignored. They are large,
reproducible, and would conflict constantly between two people. Your renders are yours;
share finished files directly if you want someone else to see them.

**There is no login.** The app assumes it is reachable only from your own machine. Do not
put it on a public URL or a tunnel without putting authentication in front of it first —
the upload route writes files to disk and the generate routes spend your API credits.

**Drafts and CSVs are local.** `data/` holds the drafts, the saved configs and the reel
log. Two clones do not sync. If you want to hand a draft to someone, send them the JSON
file out of `data/drafts/`.
