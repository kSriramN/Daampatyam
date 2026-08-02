import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If the env vars aren't set (e.g. running locally without a .env file),
// feedback submission just fails quietly and falls back to local-only —
// the app never depends on Supabase to function.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
