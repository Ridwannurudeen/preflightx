import { NextResponse } from "next/server";
import { readEntries } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ entries: readEntries() });
}
