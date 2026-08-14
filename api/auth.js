import {
  supabase,
  checkDevPassword,
  currentUser,
  devAuthConfigured,
  fail,
  hashPassword,
  ipHash,
  isDevRequest,
  issueDevToken,
  issueUserToken,
  readBody,
  verifyPassword
} from './_lib.js';
import { memoryLimit } from './_rate-limit.js';

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const SIGNUP_LIMIT = 3;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

// ตัวอักษรภาษาไหนก็ได้ ตัวเลข เว้นวรรค และ . _ - เท่านั้น
const USERNAME_RE = /^[\p{L}\p{N} ._-]{3,30}$/u;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') return whoami(req, res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return fail(res, 405, 'Method not allowed');
  }

  if (!devAuthConfigured) {
    console.error('DEV_PASSWORD / DEV_TOKEN_SECRET not set');
    return fail(res, 503, 'ระบบล็อกอินยังไม่ถูกตั้งค่า');
  }

  const body = readBody(req);
  if (!body) return fail(res, 400, 'Invalid JSON body');

  switch (String(body.kind ?? '')) {
    case 'dev': return devLogin(req, res, body);
    case 'register': return register(req, res, body);
    case 'login': return login(req, res, body);
    default: return fail(res, 400, 'ไม่รู้จักคำสั่งนี้');
  }
}

/* ---------- ใครกำลังเรียกอยู่ ---------- */

async function whoami(req, res) {
  if (isDevRequest(req)) return res.status(200).json({ dev: true, user: null });

  const user = await currentUser(req);
  if (!user) return res.status(200).json({ dev: false, user: null });

  return res.status(200).json({
    dev: false,
    user: { id: user.id, username: user.username, status: user.status }
  });
}

/* ---------- ผู้ดูแล ---------- */

async function devLogin(req, res, body) {
  const gate = memoryLimit(`dev-login:${ipHash(req)}`, 8, LOGIN_WINDOW_MS);
  if (!gate.allowed) {
    res.setHeader('Retry-After', Math.ceil(gate.retryAfterMs / 1000));
    return fail(res, 429, 'ลองผิดหลายครั้งเกินไป รอสักครู่แล้วลองใหม่');
  }

  if (!checkDevPassword(String(body.password ?? ''))) {
    return fail(res, 401, 'รหัสผ่านไม่ถูกต้อง');
  }

  const { token, expiresAt } = issueDevToken();
  return res.status(200).json({ token, expires_at: expiresAt, dev: true });
}

/* ---------- สมัครสมาชิก ---------- */

async function register(req, res, body) {
  const username = String(body.username ?? '').trim().replace(/\s+/g, ' ');
  const password = String(body.password ?? '');
  const intro = String(body.intro ?? '').trim();

  if (!USERNAME_RE.test(username)) {
    return fail(res, 400, 'ชื่อผู้ใช้ต้องยาว 3-30 ตัว ใช้ตัวอักษร ตัวเลข เว้นวรรค และ . _ - เท่านั้น');
  }
  if (password.length < 8 || password.length > 200) {
    return fail(res, 400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัว');
  }
  if (intro.length < 10 || intro.length > 500) {
    return fail(res, 400, 'ช่องแนะนำตัวต้องยาว 10-500 ตัว บอกชื่อจริงและบ้านเลขที่จะช่วยให้อนุมัติเร็วขึ้น');
  }

  const hash = ipHash(req);

  const since = new Date(Date.now() - SIGNUP_WINDOW_MS).toISOString();
  const { count, error: countError } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', hash)
    .gte('created_at', since);

  if (countError) {
    console.error('signup rate check failed', countError);
    return fail(res, 500, 'Database error');
  }
  if ((count ?? 0) >= SIGNUP_LIMIT) {
    return fail(res, 429, 'สมัครได้สูงสุด 3 บัญชีต่อชั่วโมง');
  }

  const { data, error } = await supabase
    .from('users')
    .insert({ username, password_hash: hashPassword(password), intro, ip_hash: hash })
    .select('id, username, status')
    .single();

  if (error) {
    if (error.code === '23505') return fail(res, 409, 'ชื่อผู้ใช้นี้มีคนใช้แล้ว');
    console.error('register failed', error);
    return fail(res, 500, 'Database error');
  }

  const { token, expiresAt } = issueUserToken(data.id);
  return res.status(201).json({
    token,
    expires_at: expiresAt,
    user: { id: data.id, username: data.username, status: data.status }
  });
}

/* ---------- เข้าสู่ระบบ ---------- */

async function login(req, res, body) {
  const gate = memoryLimit(`login:${ipHash(req)}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!gate.allowed) {
    res.setHeader('Retry-After', Math.ceil(gate.retryAfterMs / 1000));
    return fail(res, 429, 'ลองผิดหลายครั้งเกินไป รอสักครู่แล้วลองใหม่');
  }

  const username = String(body.username ?? '').trim().replace(/\s+/g, ' ');
  const password = String(body.password ?? '');
  if (!username || !password) return fail(res, 400, 'กรอกชื่อผู้ใช้และรหัสผ่าน');

  const { data, error } = await supabase
    .from('users')
    .select('id, username, password_hash, status')
    .eq('username_lower', username.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error('login lookup failed', error);
    return fail(res, 500, 'Database error');
  }

  // ไม่เจอชื่อนี้ก็ยังคำนวณ hash ทิ้งหนึ่งรอบ ให้เวลาตอบใกล้เคียงกับตอนเจอ
  // ไม่งั้นจับเวลาแล้วเดาได้ว่าชื่อไหนมีอยู่จริง
  const ok = data
    ? verifyPassword(password, data.password_hash)
    : verifyPassword(password, hashPassword('decoy-password'));

  if (!data || !ok) return fail(res, 401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

  const { token, expiresAt } = issueUserToken(data.id);
  return res.status(200).json({
    token,
    expires_at: expiresAt,
    user: { id: data.id, username: data.username, status: data.status }
  });
}
