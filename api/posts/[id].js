import { supabase, fail, isDevRequest } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return fail(res, 405, 'Method not allowed');
  }

  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid id');

  let query = supabase.from('posts').delete().eq('id', id);

  if (isDevRequest(req)) {
    // บัญชี dev = ผู้ดูแล ลบโพสต์ของใครก็ได้
  } else {
    // ยังไม่มีระบบ login จริง — เช็กแค่ชื่อผู้โพสต์ตรงกัน กันลบข้ามคนแบบผิวเผิน
    const author = String(req.query.author ?? '').trim();
    if (!author) return fail(res, 400, 'Missing author');
    query = query.eq('author', author);
  }

  const { data, error } = await query.select('id');

  if (error) {
    console.error('delete post failed', error);
    return fail(res, 500, 'Database error');
  }
  if (data.length === 0) return fail(res, 404, 'Post not found or not yours');

  return res.status(200).json({ deleted: id });
}
