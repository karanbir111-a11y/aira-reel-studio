import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";

/**
 * Reference photographs of the product, stored locally and served from
 * public/products.
 *
 * Two routes in, one shape out. A scraped listing gives remote CDN URLs,
 * which expire, block hotlinking and sit on another origin - so they are
 * copied here rather than linked. Anything the listing does not show well
 * enough, or any product with no link at all, is uploaded by hand. Either
 * way the rest of the pipeline sees one local URL.
 */

const DIR = path.join(process.cwd(), "public", "products");
const MAX_BYTES = 8 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function save(buffer: Buffer, contentType: string): string {
  const ext = EXT_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()];
  if (!ext) throw new Error(`Unsupported image type: ${contentType}`);
  fs.mkdirSync(DIR, { recursive: true });
  const name = `${uuid().slice(0, 8)}.${ext}`;
  fs.writeFileSync(path.join(DIR, name), buffer);
  return `/products/${name}`;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    // --- uploaded files ---
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      if (!files.length) {
        return NextResponse.json({ error: "No files supplied" }, { status: 400 });
      }

      const images: string[] = [];
      const failed: string[] = [];
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          failed.push(`${file.name} is over 8MB`);
          continue;
        }
        try {
          images.push(save(Buffer.from(await file.arrayBuffer()), file.type));
        } catch (err) {
          failed.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!images.length) {
        return NextResponse.json({ error: failed.join("; ") }, { status: 422 });
      }
      return NextResponse.json({ images, failed });
    }

    // --- remote listing images ---
    const { urls } = await request.json();
    const list: string[] = (Array.isArray(urls) ? urls : []).map(String).filter(Boolean);
    if (!list.length) return NextResponse.json({ error: "urls required" }, { status: 400 });

    const images: string[] = [];
    const failed: string[] = [];
    for (const url of list) {
      try {
        // Retail CDNs return 403 to a bare fetch, the same reason the scraper
        // sends a browser UA.
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          },
        });
        if (!res.ok) throw new Error(`returned ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > MAX_BYTES) throw new Error("over 8MB");
        images.push(save(buf, res.headers.get("content-type") || "image/jpeg"));
      } catch (err) {
        failed.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!images.length) {
      return NextResponse.json({ error: failed.join("; ") }, { status: 422 });
    }
    return NextResponse.json({ images, failed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  // Matched rather than sanitised: a path that is not one this route minted
  // is a bug or an attack, and either way must not reach unlink().
  const name = /^\/products\/([A-Za-z0-9-]{1,40}\.(?:jpg|png|webp|avif))$/.exec(url)?.[1];
  if (!name) return NextResponse.json({ error: "Not a product image" }, { status: 400 });

  try {
    fs.unlinkSync(path.join(DIR, name));
  } catch {
    // Already gone is the desired state.
  }
  return NextResponse.json({ success: true });
}
