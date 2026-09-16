// Run: node tests/order-notification.test.mjs
//
// Exercises the notification function without touching Resend: global fetch is
// stubbed so the outgoing request can be inspected. Covers the shared-secret
// check and the HTML escaping of customer-supplied values, which are the two
// things here that would be costly to get wrong.
const MOD = '../netlify/functions/order-notification.mjs';

const ORDER = {
  id: 'DS-4821',
  displayDate: '16 Sep 2026',
  status: 'pending',
  paymentMethod: 'transfer',
  customer: { name: 'Layla <script>', email: 'layla@example.com', phone: '+9613123456' },
  shippingAddress: { country: 'LB', region: 'Beirut', address: 'Hamra St, Bldg 12', notes: 'Ring twice' },
  items: [
    { name: 'Silk Jacquard Set — Offwhite', size: 'One Size', qty: 1, total: 551 },
    { name: 'Summer Kimono — Lilac', size: 'One Size', qty: 2, total: 440 }
  ],
  subtotal: 991, shipping: 0, total: 991
};

const req = (opts = {}) => {
  const method = opts.method || 'POST';
  const init = {
    method,
    headers: opts.secret === undefined ? {} : { 'x-webhook-secret': opts.secret }
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = opts.body === undefined ? JSON.stringify({ type: 'INSERT', record: ORDER }) : opts.body;
  }
  return new Request('https://x.netlify.app/.netlify/functions/order-notification', init);
};

let sent = null;
globalThis.fetch = async (url, init) => {
  sent = { url, init };
  return new Response('{"id":"re_123"}', { status: 200 });
};

const env = { RESEND_API_KEY: 'key', NOTIFY_TO: 'a@x.com, b@y.com', WEBHOOK_SECRET: 's3cret' };
Object.assign(process.env, env);

const { default: handler } = await import(MOD);
const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);

// --- auth
check('GET rejected 405', (await handler(req({ method: 'GET' }))).status === 405);
check('no secret -> 401', (await handler(req())).status === 401);
check('wrong secret -> 401', (await handler(req({ secret: 'nope' }))).status === 401);
sent = null;
check('no email sent when rejected', sent === null);

// --- bad payloads
check('malformed json -> 400', (await handler(req({ secret: 's3cret', body: 'not json' }))).status === 400);
check('empty record -> 400', (await handler(req({ secret: 's3cret', body: '{}' }))).status === 400);

// --- happy path
const ok = await handler(req({ secret: 's3cret' }));
check('valid -> 200', ok.status === 200);
const body = JSON.parse(sent.init.body);
check('resend endpoint', sent.url === 'https://api.resend.com/emails');
check('auth header', sent.init.headers.Authorization === 'Bearer key');
check('multiple recipients split', Array.isArray(body.to) && body.to.length === 2 && body.to[1] === 'b@y.com');
check('subject has id + total', body.subject === 'New order DS-4821 — AED 991.00');
check('html has phone', body.html.includes('+9613123456'));
check('html has Lebanon + governorate', body.html.includes('Beirut, Lebanon'));
check('html has both items', body.html.includes('Silk Jacquard') && body.html.includes('Summer Kimono'));
check('html has notes', body.html.includes('Ring twice'));
check('free shipping rendered', body.html.includes('Free'));
check('customer name escaped', body.html.includes('Layla &lt;script&gt;') && !body.html.includes('Layla <script>'));

// --- legacy order: no country, region under `emirate`
sent = null;
await handler(new Request('https://x/', { method: 'POST', headers: { 'x-webhook-secret': 's3cret' },
  body: JSON.stringify({ record: { ...ORDER, shippingAddress: { emirate: 'Dubai', address: 'Villa 1' } } }) }));
check('legacy falls back to UAE', JSON.parse(sent.init.body).html.includes('Dubai, United Arab Emirates'));

// --- missing config
delete process.env.RESEND_API_KEY;
check('missing env -> 500', (await handler(req({ secret: 's3cret' }))).status === 500);
process.env.RESEND_API_KEY = 'key';

// --- resend failure surfaces
globalThis.fetch = async () => new Response('bad', { status: 422 });
check('resend failure -> 502', (await handler(req({ secret: 's3cret' }))).status === 502);
