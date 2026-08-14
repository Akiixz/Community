import { supabase, fail, isDevRequest } from '../_lib.js';

const STATUSES = ['pending', 'approved', 'rejected'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return fail(res, 405, 'Method not allowed');
  }

  // รายชื่อสมาชิกกับข้อความแนะนำตัวเป็นข้อมูลส่วนตัว เฉพาะผู้ดูแลเท่านั้น
  if (!isDevRequest(req)) return fail(res, 403, 'เฉพาะผู้ดูแลเท่านั้น');

  const status = String(req.query.status ?? 'pending');
  if (!STATUSES.includes(status)) return fail(res, 400, 'สถานะไม่ถูกต้อง');

  const { data, error } = await supabase
    .from('users')
    .select('id, username, intro, status, created_at, reviewed_at')
    .eq('status', status)
    .order('created_at', { ascending: status === 'pending' })
    .limit(200);

  if (error) {
    console.error('list users failed', error);
    return fail(res, 500, 'Database error');
  }

  return res.status(200).json({ users: data });
}
