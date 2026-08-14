import { checkDevPassword, devAuthConfigured, fail, ipHash, issueDevToken } from './_lib.js';
import { memoryLimit } from './_rate-limit.js';

const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed');
  }

  res.setHeader('Cache-Control', 'no-store');

  if (!devAuthConfigured) {
    console.error('DEV_PASSWORD / DEV_TOKEN_SECRET not set');
    return fail(res, 503, 'Dev login not configured');
  }

  const gate = memoryLimit(`login:${ipHash(req)}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!gate.allowed) {
    res.setHeader('Retry-After', Math.ceil(gate.retryAfterMs / 1000));
    return fail(res, 429, 'ลองผิดหลายครั้งเกินไป รอสักครู่แล้วลองใหม่');
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (!body) return fail(res, 400, 'Invalid JSON body');

  if (!checkDevPassword(String(body.password ?? ''))) {
    return fail(res, 401, 'รหัสผ่านไม่ถูกต้อง');
  }

  const { token, expiresAt } = issueDevToken();
  return res.status(200).json({ token, expires_at: expiresAt });
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
