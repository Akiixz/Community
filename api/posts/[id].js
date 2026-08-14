import { supabase, currentUser, fail, IMAGE_BUCKET, isDevRequest } from '../_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return fail(res, 405, 'Method not allowed');
  }

  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid id');

  const dev = isDevRequest(req);
  const user = dev ? null : await currentUser(req);
  if (!dev && !user) return fail(res, 401, 'กรุณาเข้าสู่ระบบ');

  let query = supabase.from('posts').delete().eq('id', id);

  // ผู้ดูแลลบได้ทุกโพสต์ สมาชิกลบได้เฉพาะโพสต์ที่ผูกกับบัญชีตัวเอง
  if (!dev) query = query.eq('user_id', user.id);

  const { data, error } = await query.select('id, image_paths');

  if (error) {
    console.error('delete post failed', error);
    return fail(res, 500, 'Database error');
  }
  if (data.length === 0) return fail(res, 404, 'ไม่พบโพสต์นี้ หรือไม่ใช่โพสต์ของคุณ');

  // เก็บกวาดรูปที่ไม่มีโพสต์อ้างถึงแล้ว ลบไม่สำเร็จก็ไม่ถือว่าคำขอล้มเหลว
  const paths = data[0].image_paths ?? [];
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(paths);
    if (storageError) console.error('remove images failed', storageError);
  }

  return res.status(200).json({ deleted: id });
}
