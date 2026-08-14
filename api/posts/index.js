import {
  supabase,
  POST_TYPES,
  MAX_IMAGES,
  currentUser,
  fail,
  ipHash,
  isDevRequest,
  readBody,
  withImageUrls
} from '../_lib.js';
import { checkIpPostLimit, checkMemberPostLimit, MEMBER_LIMIT } from '../_rate-limit.js';

const SELECT = 'id, type, title, content, author, user_id, image_paths, created_at';

// รับเฉพาะ path ที่ /api/upload เป็นคนตั้งชื่อให้เท่านั้น
// กันคนส่ง path ไปชี้ไฟล์อื่นใน bucket
const PATH_RE = /^\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export default async function handler(req, res) {
  if (req.method === 'GET') return list(req, res);
  if (req.method === 'POST') return create(req, res);

  res.setHeader('Allow', 'GET, POST');
  return fail(res, 405, 'Method not allowed');
}

async function list(req, res) {
  const { type } = req.query;

  let query = supabase
    .from('posts')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(200);

  if (type && type !== 'all') {
    if (!POST_TYPES.includes(type)) return fail(res, 400, 'Invalid type');
    query = query.eq('type', type);
  }

  const { data, error } = await query;
  if (error) {
    console.error('list posts failed', error);
    return fail(res, 500, 'Database error');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ posts: data.map(withImageUrls) });
}

async function create(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // ชื่อผู้โพสต์มาจากบัญชีที่ล็อกอิน ไม่ได้มาจากสิ่งที่ browser ส่งมาอีกต่อไป
  const dev = isDevRequest(req);
  const user = dev ? null : await currentUser(req);

  if (!dev) {
    if (!user) return fail(res, 401, 'กรุณาเข้าสู่ระบบก่อนโพสต์');
    if (user.status === 'pending') return fail(res, 403, 'บัญชีของคุณรอผู้ดูแลอนุมัติอยู่');
    if (user.status !== 'approved') return fail(res, 403, 'บัญชีนี้ไม่ได้รับอนุมัติให้โพสต์');
  }

  const body = readBody(req);
  if (!body) return fail(res, 400, 'Invalid JSON body');

  const type = String(body.type ?? '');
  const title = String(body.title ?? '').trim();
  const content = String(body.content ?? '').trim();

  if (!POST_TYPES.includes(type)) return fail(res, 400, 'เลือกหมวดหมู่ไม่ถูกต้อง');
  if (!title || title.length > 200) return fail(res, 400, 'หัวข้อต้องยาว 1-200 ตัว');
  if (!content || content.length > 4000) return fail(res, 400, 'รายละเอียดต้องยาว 1-4000 ตัว');

  const imagePaths = Array.isArray(body.image_paths) ? body.image_paths.map(String) : [];
  if (imagePaths.length > MAX_IMAGES) return fail(res, 400, `แนบรูปได้สูงสุด ${MAX_IMAGES} รูป`);
  if (imagePaths.some(p => !PATH_RE.test(p))) return fail(res, 400, 'รูปแนบไม่ถูกต้อง');

  const hash = ipHash(req);

  if (!dev) {
    const byMember = await checkMemberPostLimit(user.id);
    if (!byMember.allowed) {
      res.setHeader('Retry-After', Math.ceil(byMember.retryAfterMs / 1000));
      return fail(res, 429, `โพสต์ได้สูงสุด ${MEMBER_LIMIT} ครั้งต่อ 10 นาที กรุณารอสักครู่`);
    }

    const byIp = await checkIpPostLimit(hash);
    if (!byIp.allowed) {
      res.setHeader('Retry-After', Math.ceil(byIp.retryAfterMs / 1000));
      return fail(res, 429, 'เครื่องนี้โพสต์ถี่เกินไป กรุณารอสักครู่');
    }
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({
      type,
      title,
      content,
      author: dev ? 'ผู้ดูแลระบบ' : user.username,
      user_id: dev ? null : user.id,
      image_paths: imagePaths,
      ip_hash: hash
    })
    .select(SELECT)
    .single();

  if (error) {
    console.error('create post failed', error);
    return fail(res, 500, 'Database error');
  }

  return res.status(201).json({ post: withImageUrls(data) });
}
