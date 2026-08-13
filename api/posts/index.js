import { supabase, POST_TYPES, fail } from '../_lib.js';

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
    .select('id, type, title, content, author, created_at')
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
  return res.status(200).json({ posts: data });
}

async function create(req, res) {
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (!body) return fail(res, 400, 'Invalid JSON body');

  const type = String(body.type ?? '');
  const title = String(body.title ?? '').trim();
  const content = String(body.content ?? '').trim();
  const author = String(body.author ?? '').trim();

  if (!POST_TYPES.includes(type)) return fail(res, 400, 'Invalid type');
  if (!title || title.length > 200) return fail(res, 400, 'Invalid title');
  if (!content || content.length > 4000) return fail(res, 400, 'Invalid content');
  if (!author || author.length > 60) return fail(res, 400, 'Invalid author');

  const { data, error } = await supabase
    .from('posts')
    .insert({ type, title, content, author })
    .select('id, type, title, content, author, created_at')
    .single();

  if (error) {
    console.error('create post failed', error);
    return fail(res, 500, 'Database error');
  }

  return res.status(201).json({ post: data });
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
