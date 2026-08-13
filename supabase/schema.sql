-- รันไฟล์นี้ใน Supabase → SQL Editor

create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  type        text        not null check (type in ('announcement', 'market', 'alert')),
  title       text        not null check (char_length(title) between 1 and 200),
  content     text        not null check (char_length(content) between 1 and 4000),
  author      text        not null check (char_length(author) between 1 and 60),
  created_at  timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_type_idx       on public.posts (type, created_at desc);

-- เปิด RLS แล้วไม่สร้าง policy = ปิดตายจากฝั่ง anon key
-- เข้าถึงได้เฉพาะ service_role key ที่อยู่ใน serverless function เท่านั้น
alter table public.posts enable row level security;

-- ข้อมูลตั้งต้น (รันครั้งเดียวพอ)
insert into public.posts (type, title, content, author)
select * from (values
  ('alert',  '⚡ แจ้งไฟฟ้าดับ ซอย 4', 'วันนี้ เวลา 13:00 - 16:00 น. ขอให้ทุกบ้านเตรียมพร้อม', 'ผู้ใหญ่บ้าน'),
  ('market', '🥬 ขายผักกาดขาวสดๆ', 'ผักปลอดสารพิษ เพิ่งเก็บเช้านี้ โลละ 40 บาท แวะมาเอาที่บ้านซอย 2 ได้เลย', 'ป้าศรี')
) as v(type, title, content, author)
where not exists (select 1 from public.posts);
