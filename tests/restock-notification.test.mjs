// Run: node tests/restock-notification.test.mjs
//
// Stubs global fetch so both Supabase's REST API and Resend can be inspected
// without touching either. The rule that matters most here is which product
// updates are ignored: getting that wrong mails the waiting list every time a
// photo is swapped.
const MOD = '../lib/restock-notification.js';

const PRODUCT = { id: 7, name: 'Silk Jacquard Set — Offwhite', cat: 'Matching Sets', price: 599, stock: 'in' };
const WAS_OUT = { ...PRODUCT, stock: 'out' };

const env = {
  RESEND_API_KEY: 'key',
  WEBHOOK_SECRET: 's3cret',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role'
};

// Whatever the waiting list should return for the next call.
let queue = [];
let calls = [];
let failSend = () => false;
let failRead = false;
let readStatus = 500;

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
  if (String(url).includes('api.resend.com')) {
    const to = JSON.parse(init.body).to[0];
    return failSend(to) ? new Response('nope', { status: 422 }) : new Response('{"id":"re_1"}', { status: 200 });
  }
  if (init.method === 'PATCH') return new Response('[]', { status: 200 });
  if (failRead) return new Response('boom', { status: readStatus });
  return new Response(JSON.stringify(queue), { status: 200 });
};

const reset = (list = []) => { queue = list; calls = []; failSend = () => false; failRead = false; };

const req = (opts = {}) => new Request('https://x/api/restock-notification', {
  method: opts.method || 'POST',
  headers: opts.secret === undefined ? {} : { 'x-webhook-secret': opts.secret },
  ...((opts.method === 'GET' || opts.method === 'HEAD') ? {} : {
    body: opts.body === undefined
      ? JSON.stringify({ type: 'UPDATE', record: opts.record || PRODUCT, old_record: 'old' in opts ? opts.old : WAS_OUT })
      : opts.body
  })
});

const { handle } = await import(MOD);
const run = (opts, e = env) => handle(req(opts), e);
const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);

const sends = () => calls.filter(c => String(c.url).includes('api.resend.com'));
const patches = () => calls.filter(c => c.init.method === 'PATCH');

// --- auth and shape
check('GET rejected 405', (await run({ method: 'GET' })).status === 405);
check('no secret -> 401', (await run({})).status === 401);
check('wrong secret -> 401', (await run({ secret: 'nope' })).status === 401);
check('malformed json -> 400', (await run({ secret: 's3cret', body: 'not json' })).status === 400);
check('no product -> 400', (await run({ secret: 's3cret', body: '{}' })).status === 400);

reset();
const { RESEND_API_KEY, ...noKey } = env;
check('missing env -> 500', (await run({ secret: 's3cret' }, noKey)).status === 500);
check('nothing sent while misconfigured', calls.length === 0);

// --- only out -> in counts
reset([{ id: 1, email: 'a@x.com' }]);
await run({ secret: 's3cret', record: { ...PRODUCT, price: 650 }, old: { ...PRODUCT, price: 599 } });
check('a price edit sends nothing', sends().length === 0);

reset([{ id: 1, email: 'a@x.com' }]);
await run({ secret: 's3cret', record: { ...PRODUCT, images: ['a.webp'] }, old: PRODUCT });
check('new photos send nothing', sends().length === 0);

reset([{ id: 1, email: 'a@x.com' }]);
await run({ secret: 's3cret', record: WAS_OUT, old: PRODUCT });
check('going OUT of stock sends nothing', sends().length === 0);

reset([{ id: 1, email: 'a@x.com' }]);
await run({ secret: 's3cret', record: WAS_OUT, old: WAS_OUT });
check('still sold out sends nothing', sends().length === 0);

reset([{ id: 1, email: 'a@x.com' }]);
await run({ secret: 's3cret', old: null });
check('an insert (no old_record) sends nothing', sends().length === 0);

reset([{ id: 1, email: 'a@x.com' }]);
await run({ secret: 's3cret', record: { ...PRODUCT, stock: 'low' } });
check('out -> low counts as back in stock', sends().length === 1);

// --- the happy path
reset([{ id: 11, email: 'a@x.com' }, { id: 12, email: 'b@x.com' }]);
const ok = await run({ secret: 's3cret' });
check('restock -> 200', ok.status === 200);
check('everyone waiting is emailed', sends().length === 2);
check('read is scoped to the piece and the un-notified',
  calls[0].url.includes('product_id=eq.7') && calls[0].url.includes('notified_at=is.null'));
check('reads with the service-role key', calls[0].init.headers.apikey === 'service-role');

const mail = sends()[0].body;
check('subject names the piece', mail.subject === 'Silk Jacquard Set — Offwhite is back in stock');
check('body names the piece', mail.html.includes('Silk Jacquard Set'));
check('body carries the price', mail.html.includes('AED 599.00'));
check('body links the shop', mail.html.includes('https://dinasstudio.com'));
check('body is signed off', mail.html.includes("Dina's Studio") && mail.html.includes('+971 58 599 5315'));

check('both are marked notified, in one call', patches().length === 1 && patches()[0].url.includes('id=in.(11,12)'));
check('marked with a timestamp', !!patches()[0].body.notified_at);

// --- an empty list costs nothing
reset([]);
await run({ secret: 's3cret' });
check('nobody waiting -> no send, no patch', sends().length === 0 && patches().length === 0);

// --- phone-only requests are left for the owner
reset([{ id: 21, email: null, phone: '+9715000000' }, { id: 22, email: 'c@x.com' }]);
await run({ secret: 's3cret' });
check('phone-only is not emailed', sends().length === 1 && sends()[0].body.to[0] === 'c@x.com');
check('phone-only stays in the queue', patches()[0].url.includes('id=in.(22)'));

// --- one bad address must not cost everyone else
reset([{ id: 31, email: 'bad@x.com' }, { id: 32, email: 'good@x.com' }]);
failSend = to => to === 'bad@x.com';
const partial = await run({ secret: 's3cret' });
check('a failed send still returns 200', partial.status === 200);
check('the rest are still emailed', sends().length === 2);
check('only the delivered one is marked', patches()[0].url.includes('id=in.(32)'));

// --- an unreadable waiting list is worth retrying, and says why
reset([]);
failRead = true;
const readFailed = await run({ secret: 's3cret' });
check('read failure -> 502', readFailed.status === 502);
check('read failure sends nothing', sends().length === 0);
check('read failure reports the upstream status', (await readFailed.text()).includes('500'));

// The wrong kind of key is the likeliest cause, so the response names it —
// Supabase's webhook log shows this text, which is where it gets looked at.
reset([]);
failRead = true; readStatus = 401;
const denied = await run({ secret: 's3cret' });
check('a denied read names the key to check', (await denied.text()).includes('SUPABASE_SERVICE_ROLE_KEY'));
reset([]);
failRead = true; readStatus = 404;
const notFound = await run({ secret: 's3cret' });
const notFoundText = await notFound.text();
check('a missing table points at the URL and the SQL',
  notFoundText.includes('SUPABASE_URL') && notFoundText.includes('restock-requests.sql'));
readStatus = 500;

// --- a malformed address is skipped rather than sent
reset([{ id: 41, email: 'not-an-email' }]);
await run({ secret: 's3cret' });
check('an invalid address is skipped', sends().length === 0 && patches().length === 0);
