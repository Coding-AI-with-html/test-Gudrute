import { createClient } from "@supabase/supabase-js";

// Tik serveriui (API route). Service role raktas apeina RLS – niekada nenaudok naršyklėje.
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Trūksta NEXT_PUBLIC_SUPABASE_URL arba SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}
