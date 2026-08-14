import crypto from 'node:crypto';
import { supabase, currentUser, fail, IMAGE_BUCKET, imageUrl, ipHash, isDevRequest, readBody } from './_lib.js';
import { memoryLimit } from './_rate-limit.js';

const MAX_BYTES = 1.5 * 1024 * 1024;
const UPLOAD_LIMIT = 20;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed');
  }

  const dev = isDevRequest(req);
  const user = dev ? null : await currentUser(req);
  if (!dev && user?.status !== 'approved') {
    return fail(res, 403, 'ต้องเป็นสมาชิกที่อนุมัติแล้วจึงแนบรูปได้');
  }

  const gate = memoryLimit(`upload:${dev ? 'dev' : user.id}:${ipHash(req)}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
  if (!gate.allowed) {
    res.setHeader('Retry-After', Math.ceil(gate.retryAfterMs / 1000));
    return fail(res, 429, 'อัปโหลดถี่เกินไป รอสักครู่');
  }

  const body = readBody(req);
  if (!body) return fail(res, 400, 'Invalid JSON body');

  let buffer;
  try {
    buffer = Buffer.from(String(body.data ?? ''), 'base64');
  } catch {
    return fail(res, 400, 'ข้อมูลรูปไม่ถูกต้อง');
  }

  if (buffer.length === 0) return fail(res, 400, 'ไม่พบข้อมูลรูป');
  if (buffer.length > MAX_BYTES) return fail(res, 413, 'ไฟล์ใหญ่เกิน 1.5 MB');

  // ดูจากไบต์จริงในไฟล์ ไม่เชื่อ content-type ที่ฝั่ง browser ส่งมา
  // เพราะเปลี่ยนชื่อไฟล์เป็น .jpg แล้วยัดอะไรมาก็ได้
  const kind = sniff(buffer);
  if (!kind) return fail(res, 400, 'รองรับเฉพาะไฟล์ JPEG, PNG และ WebP');

  // ตั้งชื่อไฟล์เองทั้งหมด ไม่แตะชื่อเดิมที่ผู้ใช้ส่งมา จึงไม่มีทาง traverse ออกนอก bucket
  const folder = new Date().toISOString().slice(0, 7);
  const path = `${folder}/${crypto.randomUUID()}.${kind.ext}`;

  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, buffer, { contentType: kind.mime, upsert: false });

  if (error) {
    console.error('upload failed', error);
    return fail(res, 500, 'อัปโหลดไม่สำเร็จ');
  }

  return res.status(201).json({ path, url: imageUrl(path) });
}

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}
