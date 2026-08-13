# แอปเพื่อชุมชน

กระดานข่าวชุมชน — static frontend + Vercel serverless functions + Supabase Postgres

## โครงสร้าง

```
public/index.html      หน้าเว็บ (static)
api/posts/index.js     GET  /api/posts?type=...   ดึงโพสต์
                       POST /api/posts            สร้างโพสต์
api/posts/[id].js      DELETE /api/posts/:id?author=...   ลบโพสต์ของตัวเอง
api/_lib.js            Supabase client + validation helper
supabase/schema.sql    ตาราง posts + index + RLS
```

`SUPABASE_SERVICE_ROLE_KEY` อยู่แค่ฝั่ง server เท่านั้น ไม่ถูกส่งไป browser
ตาราง `posts` เปิด RLS โดยไม่มี policy = anon key เข้าไม่ถึงเลย ต้องผ่าน API นี้ทางเดียว

## ขั้นตอน setup

### 1. Supabase

1. สร้าง project ที่ https://supabase.com
2. ไป **SQL Editor** → วางเนื้อหาจาก `supabase/schema.sql` → Run
3. ไป **Project Settings → API** เก็บ 2 ค่านี้
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Push ขึ้น GitHub

```bash
git init
git add .
git commit -m "Community board: Supabase backend + Vercel functions"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

### 3. Deploy บน Vercel

1. https://vercel.com/new → Import repo
2. Framework Preset: **Other** (ที่เหลือปล่อย default)
3. Environment Variables ใส่ 2 ตัว:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy

push ครั้งถัดไป Vercel จะ deploy ให้อัตโนมัติ

## รันในเครื่อง (ถ้าลง Node.js แล้ว)

```bash
npm install
npx vercel dev
```

ต้องมีไฟล์ `.env.local` (ดูตัวอย่างจาก `.env.example`)

## ข้อจำกัดที่ต้องรู้

- **ยังไม่มีระบบ login จริง** ชื่อผู้โพสต์เก็บใน localStorage การลบเช็กแค่ว่าชื่อตรงกับ `author` ในแถวนั้น
  ใครก็ยิง API ลบโพสต์คนอื่นได้ถ้ารู้ชื่อ — ถ้าจะใช้จริงต้องต่อ Supabase Auth ก่อน
- ปุ่ม "แจ้งเหตุฉุกเฉินด่วน" แค่เลือกหมวดหมู่ให้ ยังไม่ได้ต่อกับหน่วยงานฉุกเฉินใดๆ
- `community-app-functional.html` ที่ root คือเวอร์ชัน localStorage เดิม ไม่ได้ถูก deploy (Vercel serve จาก `public/`) ลบทิ้งได้
