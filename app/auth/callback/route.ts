import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(new URL("/", url.origin));
      response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
      response.headers.set("Expires", "0");
      response.headers.set("Pragma", "no-cache");
      return response;
    }
  }
  const response = NextResponse.redirect(new URL("/login?error=auth", url.origin));
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
