-- รันไฟล์นี้ใน Supabase → SQL Editor
-- เพิ่มระบบสมาชิก (สมัคร → dev อนุมัติ → โพสต์ได้) และรูปแนบโพสต์

/* ---------- ตารางสมาชิก ---------- */

create table if not exists public.users (
  id            bigint generated always as identity primary key,
  username      text        not null check (char_length(username) between 3 and 30),
  -- คอลัมน์นี้ให้ Postgres คำนวณเอง ใช้ค้นหาแบบตรงตัวโดยไม่สนตัวพิมพ์ใหญ่เล็ก
  -- ต้องมี เพราะถ้าใช้ ilike ค้นหา ตัว _ ในชื่อผู้ใช้จะกลายเป็น wildcard
  username_lower text generated always as (lower(username)) stored,
  password_hash text        not null,
  intro         text        not null check (char_length(intro) between 10 and 500),
  status        text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  ip_hash       text,
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);

create unique index if not exists users_username_key on public.users (username_lower);
create index if not exists users_status_idx on public.users (status, created_at desc);
create index if not exists users_ip_hash_idx on public.users (ip_hash, created_at desc);

-- ปิดตายเหมือนตาราง posts — เข้าถึงได้เฉพาะ service_role ใน serverless function
alter table public.users enable row level security;

/* ---------- ผูกโพสต์กับสมาชิก + รูปแนบ ---------- */

alter table public.posts
  add column if not exists user_id bigint references public.users(id) on delete set null;

alter table public.posts
  add column if not exists image_paths text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_image_paths_len'
  ) then
    alter table public.posts
      add constraint posts_image_paths_len
      check (array_length(image_paths, 1) is null or array_length(image_paths, 1) <= 4);
  end if;
end $$;

create index if not exists posts_user_id_idx on public.posts (user_id, created_at desc);
