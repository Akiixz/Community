import { supabase } from './_lib.js';

export const WINDOW_MS = 10 * 60 * 1000; // 10 นาที
export const MEMBER_LIMIT = 10;          // ต่อหนึ่งบัญชี
export const IP_LIMIT = 15;              // ต่อหนึ่ง IP กันคนเดียวสมัครหลายบัญชี

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
// นับจากตาราง posts โดยตรง ตัวเลขจึงเหมือนกันทุก instance และไม่หายตอน cold start

async function countRecent(column, value) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
    .gte('created_at', since);

  if (error) {
    console.error(`rate limit query on ${column} failed`, error);
    return null;
  }
  return count ?? 0;
}

async function limitBy(column, value, limit, fallbackKey) {
  const count = await countRecent(column, value);

  // query ล้ม ก็ยังกันด้วยตัวนับในหน่วยความจำ ดีกว่าปล่อยผ่านทั้งหมด
  if (count === null) return memoryLimit(fallbackKey, limit, WINDOW_MS);

  if (count >= limit) return { allowed: false, retryAfterMs: WINDOW_MS };
  return { allowed: true };
}

export function checkMemberPostLimit(userId) {
  return limitBy('user_id', userId, MEMBER_LIMIT, `post-user:${userId}`);
}

export function checkIpPostLimit(hash) {
  return limitBy('ip_hash', hash, IP_LIMIT, `post-ip:${hash}`);
}
