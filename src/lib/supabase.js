// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

// Anon key — for auth.signInWithPassword (respects RLS)
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Service role key — for admin writes that bypass RLS
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);