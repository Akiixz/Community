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
export const MAX_IMAGES = 4;
export const IMAGE_BUCKET = 'post-images';

export function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

export function readBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body ?? null;
}

/* ---------- ความลับของระบบ ---------- */

const DEV_PASSWORD = process.env.DEV_PASSWORD;
const DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET;

const DEV_TTL_MS = 12 * 60 * 60 * 1000;   // dev อยู่ได้ 12 ชั่วโมง
const USER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // สมาชิกอยู่ได้ 30 วัน

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

/* ---------- token ผู้ดูแล (v1) ---------- */

export function checkDevPassword(password) {
  if (!devAuthConfigured || !password) return false;
  return safeEqual(password, DEV_PASSWORD);
}

export function issueDevToken() {
  const exp = Date.now() + DEV_TTL_MS;
  const payload = `v1.${exp}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt: exp };
}

export function isDevRequest(req) {
  if (!devAuthConfigured) return false;

  const token = bearer(req);
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;

  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  return safeEqual(parts[2], sign(`v1.${exp}`));
}

/* ---------- token สมาชิก (v2) ---------- */
// คนละรูปแบบกับ token ผู้ดูแล และเซ็นคนละข้อความ
// เอา token สมาชิกไปสวมเป็นผู้ดูแลจึงทำไม่ได้

export function issueUserToken(userId) {
  const exp = Date.now() + USER_TTL_MS;
  const payload = `v2.${userId}.${exp}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt: exp };
}

export function userIdFromRequest(req) {
  if (!devAuthConfigured) return null;

  const token = bearer(req);
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v2') return null;

  const userId = Number(parts[1]);
  const exp = Number(parts[2]);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!Number.isFinite(exp) || exp < Date.now()) return null;

  if (!safeEqual(parts[3], sign(`v2.${userId}.${exp}`))) return null;
  return userId;
}

// token บอกได้แค่ว่าเคยล็อกอินสำเร็จ ไม่ได้บอกว่ายังได้รับอนุมัติอยู่ไหม
// สถานะจึงต้องอ่านจาก database ทุกครั้งที่ใช้สิทธิ์ เผื่อ dev เพิ่งถอนอนุมัติ
export async function currentUser(req) {
  const userId = userIdFromRequest(req);
  if (!userId) return null;

  const { data, error } = await supabase
    .from('users')
    .select('id, username, status, intro, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('load user failed', error);
    return null;
  }
  return data ?? null;
}

function bearer(req) {
  const header = req.headers?.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/* ---------- รหัสผ่านสมาชิก ---------- */
// scrypt มากับ Node อยู่แล้ว ไม่ต้องเพิ่ม dependency
// เก็บ salt ไว้กับ hash เพื่อให้เปลี่ยนพารามิเตอร์ในอนาคตได้โดยของเก่ายังใช้ได้

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `s1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 's1') return false;

  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  if (salt.length === 0 || expected.length !== SCRYPT.keylen) return false;

  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return crypto.timingSafeEqual(derived, expected);
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

/* ---------- รูปภาพ ---------- */

export function imageUrl(path) {
  return `${url}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`;
}

export function withImageUrls(post) {
  const paths = post.image_paths ?? [];
  const { image_paths, ...rest } = post;
  return { ...rest, images: paths.map(imageUrl) };
}
