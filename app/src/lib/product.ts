import fs from "fs";
import path from "path";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface Product {
  url: string;
  name: string;
  brand: string;
  price: string;
  colour: string;
  description: string;
  /** Flattened spec sheet - fabric, pattern, hemline and so on. */
  attributes: Record<string, string>;
  imageUrls: string[];
  /** Local copies, populated by downloadProductImages. */
  imagePaths: string[];
}

async function fetchHtml(url: string): Promise<string> {
  // Myntra and most retail sites return 403 or hang without a browser UA.
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`Product page returned ${res.status}`);
  return res.text();
}

function dedupeSentences(text: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  // Repeated blocks often run together with no space after the full stop
  // ("...XS to XL.Black and Yellow..."), so insert one before splitting.
  const spaced = text.replace(/([.!?])(?=[A-Z])/g, "$1 ");
  for (const sentence of spaced.split(/(?<=[.!?])\s+/)) {
    const key = sentence.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    // Also drop a sentence already contained in one we kept - feeds often
    // repeat a line both standalone and inside a longer run-on.
    if (kept.some((k) => k.toLowerCase().includes(key))) continue;
    seen.add(key);
    kept.push(sentence.trim());
  }
  return kept.join(" ");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Myntra embeds the full product record as `window.__myx`. */
function parseMyntra(html: string, url: string): Product | null {
  const match = html.match(/window\.__myx\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!match) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const pdp = (data.pdpData ?? {}) as Record<string, unknown>;
  if (!pdp.name) return null;

  const albums = ((pdp.media as Record<string, unknown>)?.albums ?? []) as {
    images?: { src?: string; secureSrc?: string }[];
  }[];

  // Image srcs are templates: h_($height),q_($qualityPercentage),w_($width)
  const imageUrls = albums
    .flatMap((a) => a.images ?? [])
    .map((i) => i.secureSrc || i.src || "")
    .filter(Boolean)
    .map((src) =>
      src
        .replace("($height)", "1440")
        .replace("($qualityPercentage)", "90")
        .replace("($width)", "1080")
    );

  // Myntra repeats the same copy across productDetails entries, so dedupe by
  // sentence - a four-times-duplicated description reads as corrupt data.
  const details = (pdp.productDetails ?? []) as { description?: string }[];
  const description = dedupeSentences(stripTags(details.map((d) => d.description ?? "").join(" ")));

  const rawAttrs = (pdp.articleAttributes ?? {}) as Record<string, string>;
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (v && v !== "NA") attributes[k] = String(v);
  }

  const brand = ((pdp.brand as Record<string, unknown>)?.name as string) ?? "";

  return {
    url,
    name: String(pdp.name),
    brand,
    price: pdp.mrp ? `₹${pdp.mrp}` : "",
    colour: (pdp.baseColour as string) ?? "",
    description,
    attributes,
    imageUrls,
    imagePaths: [],
  };
}

/** Fallback for any other retailer: Open Graph plus JSON-LD. */
function parseGeneric(html: string, url: string): Product {
  const meta = (prop: string) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`,
      "i"
    );
    return html.match(re)?.[1] ?? "";
  };

  let name = meta("og:title");
  let brand = "";
  let price = "";
  let description = meta("og:description");
  const imageUrls = [meta("og:image")].filter(Boolean);

  const ld = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
  if (ld) {
    try {
      const parsed = JSON.parse(ld[1]);
      const node = Array.isArray(parsed)
        ? parsed.find((n: { "@type"?: string }) => n["@type"] === "Product")
        : parsed;
      if (node) {
        name = node.name || name;
        brand = node.brand?.name || node.brand || "";
        description = node.description || description;
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        if (offer?.price) price = `${offer.priceCurrency ?? ""}${offer.price}`;
        const imgs = Array.isArray(node.image) ? node.image : [node.image];
        for (const i of imgs) if (i && !imageUrls.includes(i)) imageUrls.push(i);
      }
    } catch {
      // fall through to OG-only
    }
  }

  return {
    url,
    name,
    brand,
    price,
    colour: "",
    description: stripTags(description),
    attributes: {},
    imageUrls: imageUrls.filter(Boolean),
    imagePaths: [],
  };
}

export async function scrapeProduct(url: string): Promise<Product> {
  const html = await fetchHtml(url);
  const product = parseMyntra(html, url) ?? parseGeneric(html, url);
  if (!product.name) throw new Error("Could not read product details from that page");
  return product;
}

export async function downloadProductImages(
  product: Product,
  outDir: string,
  limit = 3
): Promise<Product> {
  fs.mkdirSync(path.resolve(outDir), { recursive: true });
  const paths: string[] = [];

  for (const [i, url] of product.imageUrls.slice(0, limit).entries()) {
    const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) continue;
    const ext = url.split("?")[0].match(/\.(jpe?g|png|webp)$/i)?.[1] ?? "jpg";
    const file = path.join(path.resolve(outDir), `product${i}.${ext}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    paths.push(file);
  }

  return { ...product, imagePaths: paths };
}

/** Condensed form for prompting - the model does not need the full spec sheet. */
export function productBrief(product: Product): string {
  const attrs = Object.entries(product.attributes)
    .slice(0, 10)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  return [
    `Product: ${product.name}`,
    product.brand && `Brand: ${product.brand}`,
    product.price && `Price: ${product.price}`,
    product.colour && `Colour: ${product.colour}`,
    attrs && `Details: ${attrs}`,
    product.description && `Description: ${product.description.slice(0, 600)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Spec-sheet keys that describe how the item LOOKS. Everything else on a
 * retail listing - size charts, net quantity, occasion tags - is noise to an
 * image model, and the marketing description ("COMFORT REDEFINED: cloud-like
 * softness...") is worse than noise: it is unrenderable copy that crowds out
 * the part of the prompt that sets the scene.
 */
const VISUAL_ATTRIBUTES = [
  "Type", "Shape", "Fit", "Length", "Hemline", "Neck", "Collar",
  "Sleeve Length", "Sleeve Styling", "Closure", "Fabric", "Weave Type",
  "Knit or Woven", "Pattern", "Print or Pattern Type", "Border",
  "Ornamentation", "Work", "Surface Styling", "Waist Rise",
];

/**
 * What a generator needs to draw the product, and nothing else. Kept short on
 * purpose: the lock block repeats in every shot prompt, so every extra clause
 * dilutes the scene description it sits beside.
 */
export function productVisualBrief(product: Product): string {
  // Retailers are inconsistent about pluralising spec keys - Myntra ships
  // "Fabrics" and "Patterns" beside "Hemline" - so match on the singular.
  const singular = (k: string) => k.toLowerCase().replace(/s$/, "");

  const attrs = VISUAL_ATTRIBUTES
    .map((key) => {
      const match = Object.keys(product.attributes).find(
        (k) => singular(k) === singular(key)
      );
      const value = match ? product.attributes[match] : "";
      return value ? `${key.toLowerCase()}: ${value.toLowerCase()}` : "";
    })
    .filter(Boolean)
    .slice(0, 8);

  // The brand lives in the name and must not reach a generator; redaction
  // strips it later, but dropping the price and blurb here keeps the block
  // down to what can actually be drawn.
  return [
    `A ${product.colour ? product.colour.toLowerCase() + " " : ""}${product.name}`,
    attrs.length ? `(${attrs.join(", ")})` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Visual briefs for several products, numbered when there is more than one. */
export function productsVisualBrief(products: Product[]): string {
  if (products.length === 0) return "";
  if (products.length === 1) return productVisualBrief(products[0]);
  return products.map((p, i) => `(${i + 1}) ${productVisualBrief(p)}`).join("; ");
}

/** Scrapes several product pages, skipping any that fail rather than aborting. */
export async function scrapeProducts(urls: string[]): Promise<Product[]> {
  const products: Product[] = [];
  for (const url of urls.map((u) => u.trim()).filter(Boolean)) {
    try {
      products.push(await scrapeProduct(url));
    } catch {
      // one bad link must not sink the whole brief
    }
  }
  return products;
}

/** Combined brief when a reel features more than one product. */
export function productsBrief(products: Product[]): string {
  if (products.length === 0) return "";
  if (products.length === 1) return productBrief(products[0]);
  return products
    .map((p, i) => `## Product ${i + 1}\n${productBrief(p)}`)
    .join("\n\n");
}

/** Every brand and product word that must not reach a video generator. */
export function redactionTerms(products: Product[]): string[] {
  const terms = new Set<string>();
  for (const p of products) {
    // Only the brand, never words from the product name: a title like
    // "Embroidered Mirror Work Lehenga" is description, and stripping it
    // deletes legitimate scene wording ("full-length mirror").
    for (const word of [p.brand, ...p.brand.split(/\s+/)]) {
      if (word && word.length > 2) terms.add(word.trim());
    }
  }
  return [...terms];
}
