import { supabase } from './_lib.js';

export const POST_LIMIT = 3;
export const POST_WINDOW_MS = 10 * 60 * 1000; // 10 นาที

/* ---------- ตัวนับในหน่วยความจำ ---------- */
// อยู่แค่ใน instance เดียว หายตอน cold start — ใช้กันยิงรัวๆ ได้ แต่กันข้ามเครื่องไม่ได้

const buckets = new Map();

export function memoryLimit(key, limit, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter(t => now - t < windowMs);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { allowed: false, retryAfterMs: windowMs - (now - hits[0]) };
  }

  hits.push(now);
  buckets.set(key, hits);

  // กัน Map โตไม่หยุดบน instance ที่อยู่ยาว
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every(t => now - t >= windowMs)) buckets.delete(k);
    }
  }

  return { allowed: true };
}

/* ---------- ตัวนับถาวรบน database ---------- */
// ใช้คอลัมน์ posts.ip_hash — ถ้ายังไม่ได้รัน migration จะถอยไปใช้ตัวนับในหน่วยความจำแทน

let ipColumnReady = null;

export async function hasIpColumn() {
  if (ipColumnReady === null) {
    ipColumnReady = supabase
      .from('posts')
      .select('ip_hash')
      .limit(1)
      .then(({ error }) => {
        if (error) {
          console.warn('posts.ip_hash missing — falling back to in-memory rate limit:', error.message);
          return false;
        }
        return true;
      });
  }
  return ipColumnReady;
}

export async function checkPostLimit(hash) {
  if (!(await hasIpColumn())) {
    return memoryLimit(`post:${hash}`, POST_LIMIT, POST_WINDOW_MS);
  }

  const since = new Date(Date.now() - POST_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', hash)
    .gte('created_at', since);

  if (error) {
    console.error('rate limit query failed', error);
    return memoryLimit(`post:${hash}`, POST_LIMIT, POST_WINDOW_MS);
  }

  if ((count ?? 0) >= POST_LIMIT) return { allowed: false, retryAfterMs: POST_WINDOW_MS };
  return { allowed: true };
}
