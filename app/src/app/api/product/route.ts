import { NextResponse } from "next/server";
import { scrapeProducts } from "@/lib/product";

/** Preview lookup for the brief screen - no images downloaded yet. */
export async function POST(request: Request) {
  const { urls } = await request.json();
  const list: string[] = Array.isArray(urls) ? urls : [];
  if (!list.length) return NextResponse.json({ error: "urls required" }, { status: 400 });

  const products = await scrapeProducts(list);
  if (!products.length) {
    return NextResponse.json({ error: "Could not read any of those pages" }, { status: 422 });
  }
  return NextResponse.json(products);
}
