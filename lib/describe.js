// POST /api/describe: drafts a product description with Gemini, for the admin
// to read and edit before saving. Nothing here writes to the database.
//
// Only the admin may call it, since every call spends the Gemini quota. The
// caller's own Supabase session token is checked against is_admin(), the same
// function the RLS policies use, so there is no second list of admins to keep.
//
// Photos arrive inline from the browser, already shrunk; that one path covers
// both an existing piece and one still being added whose photos aren't
// uploaded yet.
import { FALLBACK_URL, FALLBACK_KEY } from './product-page.js';

// Tried in order, all on the free tier. GEMINI_MODEL, if set, goes first.
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'];
// Nothing here may wait forever: when this function runs past about 100s,
// Cloudflare cuts it off with its own HTML 524 page and the admin sees only
// "Server error 524". Three Gemini attempts at 25s plus the two quick Supabase
// reads come to at most ~85s. These models think before answering by default,
// so a healthy call can take several seconds. GEMINI_TIMEOUT_MS overrides the
// per-attempt limit.
const GEMINI_TIMEOUT_MS = 25000;
const SUPABASE_TIMEOUT_MS = 5000;
const MAX_PHOTOS = 3;
const MAX_PHOTO_CHARS = 2_000_000;          // ~1.5MB once base64 is decoded
const IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'];

// Failures use 424, never a 5xx: Cloudflare swaps a function's 5xx body for its
// own HTML error page, which would hide the reason from the admin.
const FAILED = 424;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function buildPrompt({ name, cat, fabric }, examples) {
  return [
    "Write a product description for Dina's Studio, a modest-fashion shop of one-of-a-kind handmade pieces.",
    '',
    `Piece: ${name}`,
    `Category: ${cat || 'not given'}`,
    `Fabric: ${fabric || 'not given'}`,
    '',
    'Describe what the photos show: the colour, print, cut and finishing details.',
    'Use the fabric given above. Do not guess a fabric or material from the photos; if none is given, leave it out.',
    'Do not mention sizes, prices, delivery or stock.',
    'One or two sentences, about 20 to 35 words, in the same tone as these descriptions from the shop:',
    ...examples.map(d => `- ${d}`),
    '',
    'Reply with the description only: no heading, no quotation marks.'
  ].join('\n');
}

export async function handle(req, env = {}) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!env.GEMINI_API_KEY) {
    console.error('Missing environment variable: GEMINI_API_KEY');
    return new Response('AI descriptions are not set up yet: GEMINI_API_KEY is missing', { status: FAILED });
  }

  const base = env.SUPABASE_URL || FALLBACK_URL;
  const anon = env.SUPABASE_ANON_KEY || FALLBACK_KEY;

  const token = (/^Bearer (.+)$/.exec(req.headers.get('Authorization') || '') || [])[1];
  if (!token) return new Response('Sign in first', { status: 401 });
  try {
    const res = await fetch(`${base}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    });
    if (!res.ok || (await res.json()) !== true) return new Response('Admins only', { status: 403 });
  } catch (e) {
    console.error('Admin check failed:', e.message);
    return new Response('Admins only', { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response('Bad request', { status: 400 }); }
  const name = String(body.name || '').trim();
  const images = Array.isArray(body.images) ? body.images : [];
  if (!name) return new Response('Give the piece a name first', { status: 400 });
  if (images.length > MAX_PHOTOS) return new Response(`At most ${MAX_PHOTOS} photos`, { status: 400 });
  if (images.some(i => !i || !IMAGE_TYPES.includes(i.mimeType) || typeof i.data !== 'string' || !i.data || i.data.length > MAX_PHOTO_CHARS)) {
    return new Response('Photos must be WebP, JPEG or PNG under 1.5MB', { status: 400 });
  }

  // The shop's best-selling descriptions set the tone. Without them it still
  // writes a description, just a less on-brand one, so a failure isn't fatal.
  let examples = [];
  try {
    const res = await fetch(`${base}/rest/v1/products?select=desc&desc=not.is.null&order=pop.desc&limit=4`,
      { headers: { apikey: anon, Authorization: `Bearer ${anon}` }, signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });
    if (res.ok) examples = (await res.json()).map(p => p.desc).filter(Boolean);
  } catch (e) { console.warn('Could not read example descriptions:', e.message); }

  const payload = JSON.stringify({
    contents: [{ parts: [
      ...images.map(i => ({ inline_data: { mime_type: i.mimeType, data: i.data } })),
      { text: buildPrompt({ name, cat: body.cat, fabric: String(body.fabric || '').trim() }, examples) }
    ] }]
  });

  // A busy model (503 "high demand"), one over its free-tier limit (429) or one
  // that doesn't answer within the time limit hands over to the next; each
  // model has its own free allowance. Any other error, such as a bad key, would
  // fail the same way on every model, so it stops here.
  const limit = Number(env.GEMINI_TIMEOUT_MS) || GEMINI_TIMEOUT_MS;
  const isTimeout = e => e && (e.name === 'TimeoutError' || e.name === 'AbortError');
  const models = [...new Set([env.GEMINI_MODEL, ...FALLBACK_MODELS].filter(Boolean))];
  let res = null;
  let timedOut = false;
  for (const model of models) {
    res = null;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(limit)
      });
    } catch (e) {
      if (isTimeout(e)) {
        timedOut = true;
        console.warn(`Gemini ${model} did not answer within ${limit}ms; trying the next model`);
        continue;
      }
      console.error('Gemini unreachable:', e.message);
      return new Response('Could not reach Gemini', { status: FAILED });
    }
    if (res.status !== 503 && res.status !== 429) break;
    console.warn(`Gemini ${model} answered ${res.status}; trying the next model`);
  }

  if (!res) {
    return new Response('Gemini took too long on every model. Try again later.', { status: 429 });
  }
  if (res.status === 503 || res.status === 429) {
    return new Response(`Gemini is busy or over its daily limit on every model${timedOut ? ' (some also took too long)' : ''}. Try again later.`, { status: 429 });
  }
  // The time limit also covers reading the answer, which can stall after the
  // headers arrive; that is the same "took too long", not a server crash.
  try {
    if (!res.ok) {
      // Google's reason ("API key not valid", "model not found") goes back to the
      // admin's toast; it never contains the key, which travels in a header.
      const raw = await res.text();
      console.error('Gemini error', res.status, raw.slice(0, 300));
      let reason = '';
      try { reason = JSON.parse(raw).error.message || ''; } catch {}
      return new Response(`Gemini error ${res.status}${reason ? ': ' + reason.slice(0, 200) : ''}`, { status: FAILED });
    }
    return await readAnswer(res);
  } catch (e) {
    if (!isTimeout(e)) throw e;
    console.warn('Gemini stalled while answering');
    return new Response('Gemini took too long. Try again later.', { status: 429 });
  }
}

async function readAnswer(res) {
  const data = await res.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.map(p => p.text || '').join('').trim().replace(/^["“]+|["”]+$/g, '').trim();
  if (!text) return new Response('Gemini returned nothing', { status: FAILED });
  return json({ text });
}
