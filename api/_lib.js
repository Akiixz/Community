import crypto from 'node:crypto';
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

/* ---------- บัญชี dev ---------- */

const DEV_PASSWORD = process.env.DEV_PASSWORD;
const DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 ชั่วโมง

export const devAuthConfigured = Boolean(DEV_PASSWORD && DEV_TOKEN_SECRET);

function sign(payload) {
  return crypto.createHmac('sha256', DEV_TOKEN_SECRET).update(payload).digest('base64url');
}

// เทียบแบบ constant-time กัน timing attack — ต้อง hash ก่อนเพราะความยาวต่างกันทำให้ throw
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkDevPassword(password) {
  if (!devAuthConfigured || !password) return false;
  return safeEqual(password, DEV_PASSWORD);
}

export function issueDevToken() {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `v1.${exp}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt: exp };
}

export function isDevRequest(req) {
  if (!devAuthConfigured) return false;

  const header = req.headers?.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;

  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  return safeEqual(parts[2], sign(`v1.${exp}`));
}

/* ---------- ระบุตัวผู้เรียก ---------- */

export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '');
  const first = forwarded.split(',')[0].trim();
  return first || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// เก็บเป็น hash ไม่เก็บ IP ตรงๆ — พอสำหรับนับ rate limit แต่ย้อนกลับเป็นตัวคนไม่ได้
export function ipHash(req) {
  const salt = DEV_TOKEN_SECRET ?? 'community-app';
  return crypto.createHmac('sha256', salt).update(clientIp(req)).digest('hex').slice(0, 32);
}
