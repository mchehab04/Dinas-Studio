// Run: node tests/order-notification.test.mjs
//
// Exercises the notification function without touching Resend: global fetch is
// stubbed so the outgoing request can be inspected. Covers the shared-secret
// check and the HTML escaping of customer-supplied values, which are the two
// things here that would be costly to get wrong.
const MOD = '../lib/order-notification.js';

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

// Every send is captured so the two emails can be told apart, and individual
// sends can be made to fail to prove they are independent.
let sends = [];
let failFor = () => false;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  sends.push({ url, init, body });
  if (failFor(body)) return new Response('nope', { status: 422 });
  return new Response('{"id":"re_123"}', { status: 200 });
};
const reset = () => { sends = []; failFor = () => false; };
const found = p => (sends.find(s => p(s.body)) || {}).body;
const ownerMail = () => found(b => b.subject.startsWith('New order'));
const customerMail = () => found(b => b.subject.startsWith("Your Dina's Studio"));

const env = { RESEND_API_KEY: 'key', NOTIFY_TO: 'a@x.com, b@y.com', WEBHOOK_SECRET: 's3cret' };

const { handle } = await import(MOD);
const handler = (request, e = env) => handle(request, e);
const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);

// --- auth
check('GET rejected 405', (await handler(req({ method: 'GET' }))).status === 405);
check('no secret -> 401', (await handler(req())).status === 401);
check('wrong secret -> 401', (await handler(req({ secret: 'nope' }))).status === 401);
reset();
check('no email sent when rejected', sends.length === 0);

// --- bad payloads
check('malformed json -> 400', (await handler(req({ secret: 's3cret', body: 'not json' }))).status === 400);
check('empty record -> 400', (await handler(req({ secret: 's3cret', body: '{}' }))).status === 400);

// --- happy path: both emails
reset();
const ok = await handler(req({ secret: 's3cret' }));
check('valid -> 200', ok.status === 200);
check('sends two emails', sends.length === 2);
check('resend endpoint', sends[0].url === 'https://api.resend.com/emails');
check('auth header', sends[0].init.headers.Authorization === 'Bearer key');

// --- owner copy
const owner = ownerMail();
check('owner: recipients split', Array.isArray(owner.to) && owner.to.length === 2 && owner.to[1] === 'b@y.com');
check('owner: subject has id + total', owner.subject === 'New order DS-4821 — AED 991.00');
check('owner: has phone', owner.html.includes('+9613123456'));
check('owner: has email', owner.html.includes('layla@example.com'));
check('owner: Lebanon + governorate', owner.html.includes('Beirut, Lebanon'));
check('owner: both items', owner.html.includes('Silk Jacquard') && owner.html.includes('Summer Kimono'));
check('owner: has notes', owner.html.includes('Ring twice'));
check('owner: free shipping', owner.html.includes('Free'));
check('owner: name escaped', owner.html.includes('Layla &lt;script&gt;') && !owner.html.includes('Layla <script>'));

// --- customer copy
const cust = customerMail();
check('customer: goes to the order address', cust.to.length === 1 && cust.to[0] === 'layla@example.com');
check('customer: reply-to is the owner', cust.reply_to === 'a@x.com');
check('customer: subject names the order', cust.subject === "Your Dina's Studio order DS-4821");
check('customer: transfer next-step', cust.html.includes('WhatsApp') && cust.html.includes('reserved until payment'));
check('customer: shows delivery window', cust.html.includes('3–5 business days'));
check('customer: lists items', cust.html.includes('Silk Jacquard') && cust.html.includes('Summer Kimono'));
check('customer: omits internal notes', !cust.html.includes('Ring twice'));

// The greeting uses only the first word of the name, so escaping has to be
// proven with markup inside that first word.
reset();
await handler(new Request('https://x/', { method: 'POST', headers: { 'x-webhook-secret': 's3cret' },
  body: JSON.stringify({ record: { ...ORDER,
    customer: { name: '<img src=x onerror=alert(1)> Smith', email: 'layla@example.com', phone: '+9613123456' } } }) }));
check('customer: greeting escaped', customerMail().html.includes('&lt;img') && !customerMail().html.includes('<img'));

// --- COD gets a different next step
reset();
await handler(new Request('https://x/', { method: 'POST', headers: { 'x-webhook-secret': 's3cret' },
  body: JSON.stringify({ record: { ...ORDER, paymentMethod: 'cod',
    shippingAddress: { country: 'AE', region: 'Dubai', address: 'Villa 1' } } }) }));
check('cod: pay the courier', customerMail().html.includes('Pay the courier'));
check('cod: UAE delivery window', customerMail().html.includes('1–2 business days'));

// --- legacy order: no country, region under `emirate`
reset();
await handler(new Request('https://x/', { method: 'POST', headers: { 'x-webhook-secret': 's3cret' },
  body: JSON.stringify({ record: { ...ORDER, shippingAddress: { emirate: 'Dubai', address: 'Villa 1' } } }) }));
check('legacy falls back to UAE', ownerMail().html.includes('Dubai, United Arab Emirates'));

// --- a bad customer address must not cost the owner their notification
reset();
const noEmail = await handler(new Request('https://x/', { method: 'POST', headers: { 'x-webhook-secret': 's3cret' },
  body: JSON.stringify({ record: { ...ORDER, customer: { name: 'X', phone: '+9613123456', email: 'not-an-email' } } }) }));
check('bad customer email -> still 200', noEmail.status === 200);
check('bad customer email -> owner still mailed', sends.length === 1 && !!ownerMail());

// --- a failing customer send must not fail the webhook
reset();
failFor = b => b.subject.startsWith("Your Dina's Studio");
const custFailed = await handler(req({ secret: 's3cret' }));
check('customer send fails -> still 200', custFailed.status === 200);
check('customer send fails -> owner mailed', !!ownerMail());

// --- but a failing owner send does, and skips the customer entirely
reset();
failFor = b => b.subject.startsWith('New order');
const ownerFailed = await handler(req({ secret: 's3cret' }));
check('owner send fails -> 502', ownerFailed.status === 502);
check('owner send fails -> customer not mailed', !customerMail());

// --- missing config
reset();
const { RESEND_API_KEY, ...noKey } = env;
check('missing env -> 500', (await handler(req({ secret: 's3cret' }), noKey)).status === 500);
