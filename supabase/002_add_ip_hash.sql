-- รันไฟล์นี้ใน Supabase → SQL Editor (สำหรับ database ที่สร้างไปแล้ว)
-- เพิ่มคอลัมน์ไว้นับ rate limit ต่อผู้ใช้ เก็บเป็น HMAC hash ไม่ใช่ IP ดิบ

alter table public.posts add column if not exists ip_hash text;

create index if not exists posts_ip_hash_idx on public.posts (ip_hash, created_at desc);
