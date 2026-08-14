import { supabase, fail, isDevRequest, readBody } from '../_lib.js';

const REVIEWABLE = ['approved', 'rejected', 'pending'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return fail(res, 405, 'Method not allowed');
  }

  if (!isDevRequest(req)) return fail(res, 403, 'เฉพาะผู้ดูแลเท่านั้น');

  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid id');

  const body = readBody(req);
  if (!body) return fail(res, 400, 'Invalid JSON body');

  const status = String(body.status ?? '');
  if (!REVIEWABLE.includes(status)) return fail(res, 400, 'สถานะไม่ถูกต้อง');

  const { data, error } = await supabase
    .from('users')
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, username, status')
    .maybeSingle();

  if (error) {
    console.error('review user failed', error);
    return fail(res, 500, 'Database error');
  }
  if (!data) return fail(res, 404, 'ไม่พบสมาชิกคนนี้');

  return res.status(200).json({ user: data });
}
