import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var');
}

// service_role key ข้าม RLS ได้ — ห้ามส่ง client นี้ออกไปฝั่ง browser เด็ดขาด
export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const POST_TYPES = ['announcement', 'market', 'alert'];

export function fail(res, status, message) {
  return res.status(status).json({ error: message });
}
