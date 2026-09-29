// Run: node tests/describe.test.mjs
//
// Stubs global fetch so Supabase (the admin check and the example
// descriptions) and Gemini can be inspected without touching either. The rule
// that matters most is that nobody but the admin can spend the Gemini quota.
const { handle } = await import('../lib/describe.js');

const env = { GEMINI_API_KEY: 'gem-key', SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon' };
const PHOTO = { mimeType: 'image/webp', data: 'AAAA' };

let isAdmin = true;
let geminiReply = { candidates: [{ content: { parts: [{ text: '  "A relaxed silk set with a soft drape."  ' }] } }] };
let geminiStatus = 200;
let calls = [];

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, init, body: init.body ? JSON.parse(init.body) : null });
  if (u.includes('/rpc/is_admin')) return new Response(JSON.stringify(isAdmin), { status: 200 });
  if (u.includes('/rest/v1/products')) return new Response(JSON.stringify([
    { desc: 'A breezy short set in a mixed floral print.' },
    { desc: 'A flowing powder-blue kimono with gold trim.' }
  ]), { status: 200 });
  if (u.includes('generativelanguage.googleapis.com')) {
    return new Response(JSON.stringify(geminiReply), { status: geminiStatus });
  }
  return new Response('unexpected', { status: 500 });
};

const reset = () => { isAdmin = true; geminiStatus = 200; calls = [];
  geminiReply = { candidates: [{ content: { parts: [{ text: '  "A relaxed silk set with a soft drape."  ' }] } }] }; };
const req = (body, { token = 'user-jwt', method = 'POST' } = {}) => new Request('https://x/api/describe', {
  method,
  headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
});
const good = { name: 'Silk Jacquard Set', cat: 'Matching Sets', fabric: 'Silk Jacquard', images: [PHOTO] };
const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
const gemini = () => calls.find(c => c.url.includes('generativelanguage'));

// --- who may call it
check('GET rejected 405', (await handle(req(null, { method: 'GET' }), env)).status === 405);
reset();
const { GEMINI_API_KEY, ...noKey } = env;
check('no Gemini key -> 500', (await handle(req(good), noKey)).status === 500);
check('nothing is called while misconfigured', calls.length === 0);

reset();
check('no sign-in -> 401', (await handle(req(good, { token: null }), env)).status === 401);
check('Gemini is not called without a sign-in', !gemini());

reset(); isAdmin = false;
check('a signed-in customer -> 403', (await handle(req(good), env)).status === 403);
check('Gemini is not called for a customer', !gemini());
const adminCheck = calls.find(c => c.url.includes('/rpc/is_admin'));
check('the admin check carries the caller\'s own token',
  !!adminCheck && adminCheck.init.headers.Authorization === 'Bearer user-jwt' && adminCheck.init.headers.apikey === 'anon');

// --- what it accepts
reset();
check('malformed json -> 400', (await handle(req('not json'), env)).status === 400);
reset();
check('no name -> 400', (await handle(req({ ...good, name: '  ' }), env)).status === 400);
reset();
check('more than 3 photos -> 400', (await handle(req({ ...good, images: [PHOTO, PHOTO, PHOTO, PHOTO] }), env)).status === 400);
reset();
check('a non-image -> 400', (await handle(req({ ...good, images: [{ mimeType: 'text/html', data: 'AAAA' }] }), env)).status === 400);
reset();
check('an oversized photo -> 400', (await handle(req({ ...good, images: [{ mimeType: 'image/webp', data: 'A'.repeat(2_000_001) }] }), env)).status === 400);

// --- the happy path
reset();
const ok = await handle(req(good), env);
const out = await ok.json();
check('admin with a photo -> 200', ok.status === 200);
check(`the text comes back trimmed and unquoted ("${out.text}")`, out.text === 'A relaxed silk set with a soft drape.');
const g = gemini();
check('Gemini is called with the key in a header, not the URL',
  !!g && g.init.headers['x-goog-api-key'] === 'gem-key' && !g.url.includes('gem-key'));
check('the default model is Gemini 3.8 Flash', !!g && g.url.includes('/models/gemini-3.8-flash:generateContent'));
const parts = g ? g.body.contents[0].parts : [];
check('the photo is sent inline', parts.some(p => p.inline_data && p.inline_data.mime_type === 'image/webp' && p.inline_data.data === 'AAAA'));
const prompt = parts.filter(p => p.text).map(p => p.text).join('\n');
check('the prompt names the piece, category and fabric',
  prompt.includes('Silk Jacquard Set') && prompt.includes('Matching Sets') && prompt.includes('Silk Jacquard'));
check('the prompt carries the shop\'s own descriptions as examples', prompt.includes('A breezy short set in a mixed floral print.'));
check('the prompt says to use the given fabric rather than guess', /fabric/i.test(prompt) && /guess/i.test(prompt));

reset();
await handle(req(good), { ...env, GEMINI_MODEL: 'gemini-2.5-flash' });
check('GEMINI_MODEL overrides the model', gemini().url.includes('/models/gemini-2.5-flash:generateContent'));

reset();
const noPhotos = await handle(req({ ...good, images: [] }), env);
check('no photos still works, from the details alone', noPhotos.status === 200);

// --- when Gemini fails
reset(); geminiStatus = 429; geminiReply = { error: { message: 'quota' } };
const limited = await handle(req(good), env);
check('Gemini over its limit -> 429 passed on', limited.status === 429);
check('and says to try later', /try again later/i.test(await limited.text()));

reset(); geminiStatus = 500; geminiReply = { error: { message: 'boom' } };
check('a Gemini error -> 502', (await handle(req(good), env)).status === 502);

reset(); geminiReply = { candidates: [{ content: { parts: [] } }] };
check('an empty answer -> 502', (await handle(req(good), env)).status === 502);
