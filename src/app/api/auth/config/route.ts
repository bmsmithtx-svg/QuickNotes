import { NextResponse } from "next/server";

import { getSupabaseBrowserConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(getSupabaseBrowserConfig(), {
      headers: {
        "Cache-Control": "private, no-store"
      }
    });
  } catch {
    return NextResponse.json(
      {
        error: "Authentication configuration unavailable."
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store"
        }
      }
    );
  }
}
