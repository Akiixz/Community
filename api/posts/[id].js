import { supabase, fail } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return fail(res, 405, 'Method not allowed');
  }

  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid id');

  const author = String(req.query.author ?? '').trim();
  if (!author) return fail(res, 400, 'Missing author');

  // ยังไม่มีระบบ login จริง — เช็กแค่ชื่อผู้โพสต์ตรงกัน กันลบข้ามคนแบบผิวเผิน
  const { data, error } = await supabase
    .from('posts')
    .delete()
    .eq('id', id)
    .eq('author', author)
    .select('id');

  if (error) {
    console.error('delete post failed', error);
    return fail(res, 500, 'Database error');
  }
  if (data.length === 0) return fail(res, 404, 'Post not found or not yours');

  return res.status(200).json({ deleted: id });
}
