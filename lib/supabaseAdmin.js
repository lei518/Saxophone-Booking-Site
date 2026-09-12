import { createClient } from '@supabase/supabase-js';

let client = null;

export function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Supabase is not configured yet. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  }
  client = createClient(url, key);
  return client;
}

// Password checking now lives in lib/auth.js — import { requireAdmin } from there.