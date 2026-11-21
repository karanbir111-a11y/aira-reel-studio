import { NextResponse } from "next/server";
import { readBrand, writeBrand, EMPTY_BRAND } from "@/lib/brand";

export async function GET() {
  return NextResponse.json(readBrand());
}

export async function PUT(request: Request) {
  const body = await request.json();
  return NextResponse.json(
    writeBrand({
      ...EMPTY_BRAND,
      brandName: body.brandName ?? "",
      about: body.about ?? "",
      audience: body.audience ?? "",
      toneRules: body.toneRules ?? "",
      alwaysEnsure: body.alwaysEnsure ?? "",
      alwaysAvoid: body.alwaysAvoid ?? "",
      updatedAt: "",
    })
  );
}
