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
let busy = new Set();   // models answering 503 "high demand"
let hang = new Set();   // models that never answer; only a timeout signal ends the call

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, init, body: init.body ? JSON.parse(init.body) : null });
  if (u.includes('/rpc/is_admin')) return new Response(JSON.stringify(isAdmin), { status: 200 });
  if (u.includes('/rest/v1/products')) return new Response(JSON.stringify([
    { desc: 'A breezy short set in a mixed floral print.' },
    { desc: 'A flowing powder-blue kimono with gold trim.' }
  ]), { status: 200 });
  if (u.includes('generativelanguage.googleapis.com')) {
    const model = /models\/([^:]+):/.exec(u)[1];
    if (hang.has(model)) return new Promise((_, reject) => {
      if (init.signal) init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')));
    });
    if (busy.has(model)) return new Response(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.' } }), { status: 503 });
    return new Response(JSON.stringify(geminiReply), { status: geminiStatus });
  }
  return new Response('unexpected', { status: 500 });
};

const reset = () => { isAdmin = true; geminiStatus = 200; calls = []; busy = new Set(); hang = new Set();
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
// Every failure is a 4xx: Cloudflare replaces a function's 5xx body with its
// own HTML error page, which hid Google's reason from the admin entirely.
const unset = await handle(req(good), noKey);
check('no Gemini key -> 424, saying what is missing', unset.status === 424 && (await unset.text()).includes('GEMINI_API_KEY'));
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
// A busy model hands over to the next Flash model rather than failing.
const tried = () => calls.filter(c => c.url.includes('generativelanguage')).map(c => /models\/([^:]+):/.exec(c.url)[1]);
reset(); busy = new Set(['gemini-3.8-flash']);
const fellBack = await handle(req(good), env);
check('3.8 Flash busy -> 3.6 Flash answers', fellBack.status === 200 && JSON.stringify(tried()) === JSON.stringify(['gemini-3.8-flash', 'gemini-3.6-flash']));
reset(); busy = new Set(['gemini-3.8-flash', 'gemini-3.6-flash']);
await handle(req(good), env);
check(`then 2.5 Flash (${tried().join(' > ')})`, JSON.stringify(tried()) === JSON.stringify(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash']));
reset(); busy = new Set(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash']);
const allBusy = await handle(req(good), env);
const allBusyText = await allBusy.text();
check(`all busy -> a 4xx that says so ("${allBusyText}")`, allBusy.status === 429 && /try again later/i.test(allBusyText));
reset(); geminiStatus = 400; geminiReply = { error: { message: 'API key not valid.' } };
await handle(req(good), env);
check('a bad key is not retried on other models', tried().length === 1);
reset(); busy = new Set(['gemini-2.5-flash']);
await handle(req(good), { ...env, GEMINI_MODEL: 'gemini-2.5-flash' });
check('a GEMINI_MODEL override is tried first, then the defaults', tried()[0] === 'gemini-2.5-flash' && tried()[1] === 'gemini-3.8-flash');

// A model that never answers must not hang the request until Cloudflare cuts it
// off with its own HTML 524 page: each attempt has a time limit, and a model
// that times out hands over to the next, like a busy one.
const envFast = { ...env, GEMINI_TIMEOUT_MS: '150' };
const guard = (p, ms = 4000) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
reset(); hang = new Set(['gemini-3.8-flash']);
const hung = await guard(handle(req(good), envFast));
check('3.8 Flash hangs -> 3.6 Flash answers', !!hung && hung.status === 200 && JSON.stringify(tried()) === JSON.stringify(['gemini-3.8-flash', 'gemini-3.6-flash']));
reset(); hang = new Set(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash']);
const allHung = await guard(handle(req(good), envFast));
const allHungText = allHung ? await allHung.text() : '';
check(`every model hanging -> a 4xx that says so ("${allHungText}")`, !!allHung && allHung.status === 429 && /too long|try again later/i.test(allHungText));
reset(); hang = new Set(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash']);
const t0 = Date.now(); await guard(handle(req(good), envFast));
check(`and gives up within the budget (${Date.now() - t0}ms)`, Date.now() - t0 < 2000);
reset(); await handle(req(good), envFast);
const slowCalls = calls.filter(c => /is_admin|rest\/v1\/products/.test(c.url));
check('the admin check and example read are time-limited too', slowCalls.length === 2 && slowCalls.every(c => !!c.init.signal));

reset(); geminiStatus = 429; geminiReply = { error: { message: 'quota' } };
const limited = await handle(req(good), env);
check('Gemini over its limit -> 429 passed on', limited.status === 429);
check('and says to try later', /try again later/i.test(await limited.text()));

reset(); geminiStatus = 500; geminiReply = { error: { message: 'boom' } };
check('a Gemini error -> 424, not a 5xx', (await handle(req(good), env)).status === 424);

// Google's own reason reaches the admin's toast, so a bad key or a retired
// model says so instead of a bare status code.
reset(); geminiStatus = 400; geminiReply = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } };
const badKey = await handle(req(good), env);
const badKeyText = await badKey.text();
check(`a rejected key says why ("${badKeyText}")`, badKey.status === 424 && badKeyText.includes('API key not valid'));
check('without echoing the key itself', !badKeyText.includes('gem-key'));
reset(); geminiStatus = 404; geminiReply = { error: { code: 404, message: 'models/gemini-x is not found for API version v1beta', status: 'NOT_FOUND' } };
check('a retired model says which', (await (await handle(req(good), env)).text()).includes('gemini-x is not found'));

reset(); geminiReply = { candidates: [{ content: { parts: [] } }] };
check('an empty answer -> 424', (await handle(req(good), env)).status === 424);
