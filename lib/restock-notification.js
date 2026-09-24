// Receives a Supabase Database Webhook on UPDATE of public.products and emails
// everyone waiting on a piece that has just come back in stock.
//
// It acts only on out -> in. Every other edit to a product (price, photos, a
// piece going out of stock) arrives here too and must be ignored, or the
// waiting list gets mailed every time a photo is swapped.
//
// It reads and writes restock_requests with the service-role key. That key
// bypasses RLS entirely, which is the point — the table is admin-only and a
// webhook has no user session — and also why it lives only as a Pages secret.
//
// Carries its own small send helper rather than sharing one with the order
// notification: that function works and takes money-critical traffic, and a
// dozen duplicated lines are cheaper than the risk of refactoring it.
//
// Pricing is the exception: it is shared, not copied, because a restock email
// quoting a different price from the shop is exactly the drift to avoid.
import { chargedPrice } from './product-page.js';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONTACT = {
  phone: '+971 58 599 5315',
  whatsapp: 'https://wa.me/971585995315',
  site: 'https://dinasstudio.com'
};

function buildHtml(product) {
  const price = Number(product.price);
  const charged = chargedPrice(product);
  // A piece can come back in stock already marked down. Quote what it now
  // costs, with the original struck beside it, as the shop itself shows it.
  const priceLine = charged < price
    ? `AED ${charged.toFixed(2)} <span style="color:#8A6B63;text-decoration:line-through;font-weight:600;font-size:13px;">AED ${price.toFixed(2)}</span>`
    : `AED ${price.toFixed(2)}`;
  return `<div style="font-family:system-ui,-apple-system,sans-serif;color:#3B2323;max-width:560px;">
    <h2 style="color:#A63A3A;margin:0 0 4px;">It's back</h2>
    <p style="margin:0 0 18px;color:#8A6B63;font-size:14px;">
      You asked us to tell you when this piece was available again.
    </p>

    <div style="background:#FDF3F0;border:1px solid #F3C7CC;border-radius:12px;padding:16px;margin-bottom:18px;">
      <div style="font-weight:700;font-size:16px;color:#A63A3A;">${esc(product.name)}</div>
      <div style="color:#8A6B63;font-size:13px;margin-top:2px;">${esc(product.cat)}</div>
      ${Number.isFinite(price) ? `<div style="margin-top:8px;font-size:15px;font-weight:700;">${priceLine}</div>` : ''}
    </div>

    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">
      Every piece is one of a kind, so it can go again quickly — this isn't a
      reservation.
    </p>

    <a href="${CONTACT.site}" style="display:inline-block;background:#A63A3A;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:18px;font-size:14px;">
      See it in the shop
    </a>

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #EFD6D9;font-size:13px;line-height:1.7;">
      <div style="font-weight:700;color:#A63A3A;font-size:15px;">Dina's Studio</div>
      <div style="color:#8A6B63;font-size:12.5px;">Modest fashion, handmade to move with you</div>
      <div style="margin-top:10px;">
        WhatsApp or call
        <a href="${CONTACT.whatsapp}" style="color:#A63A3A;text-decoration:none;font-weight:700;">${CONTACT.phone}</a><br>
        <a href="${CONTACT.site}" style="color:#A63A3A;text-decoration:none;">dinasstudio.com</a>
      </div>
      <div style="margin-top:12px;color:#8A6B63;font-size:11.5px;">
        You're getting this because you asked to be told about this one piece.
        It's a one-off — there's nothing to unsubscribe from.
      </div>
    </div>
  </div>`;
}

export async function handle(req, env = {}) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { RESEND_API_KEY, WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const missing = Object.entries({ RESEND_API_KEY, WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error('Missing environment variables:', missing.join(', '));
    return new Response('Not configured', { status: 500 });
  }

  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    console.warn('Rejected webhook: bad or missing secret');
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const product = body.record;
  const before = body.old_record;
  if (!product || !product.id) return new Response('No product in payload', { status: 400 });

  // The only transition that means "back in stock". Everything else — a price
  // edit, new photos, a piece going out — lands here too and is not news.
  if (!before || before.stock !== 'out' || product.stock === 'out') {
    return new Response('Not a restock', { status: 200 });
  }

  const rest = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  let waiting;
  try {
    const res = await rest(`restock_requests?product_id=eq.${encodeURIComponent(product.id)}&notified_at=is.null`);
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 160);
      // 401/403 here is almost always the wrong kind of key: a management
      // token (sbp_...) or a publishable key instead of the service role.
      // Saying so in the response puts the answer straight into Supabase's
      // webhook log, rather than only in Cloudflare's.
      // 401 is the key itself; 403 is far more often a missing table grant,
      // since bypassing RLS and holding privileges are separate things. Read
      // the hint Postgres sends back before doubting the key.
      const hint = res.status === 401
        ? ' — check SUPABASE_SERVICE_ROLE_KEY is the project service_role / secret key'
        : res.status === 403
        ? ' — the key authenticated but the role lacks privileges; run: grant all on public.restock_requests to service_role;'
        : res.status === 404 ? ' — check SUPABASE_URL, and that restock-requests.sql has been run' : '';
      throw new Error(`${res.status}${hint}: ${detail}`);
    }
    waiting = await res.json();
  } catch (e) {
    console.error('Could not read the waiting list:', e.message);
    return new Response(`Read failed ${e.message}`.slice(0, 300), { status: 502 });
  }

  if (!waiting.length) {
    console.log('Restocked', product.id, '- nobody waiting');
    return new Response('Nobody waiting', { status: 200 });
  }

  const html = buildHtml(product);
  const notified = [];

  for (const r of waiting) {
    const email = String(r.email || '').trim();
    // Phone-only requests are left for the owner to message by hand — there is
    // no messaging API here, and the admin waiting list shows them with a
    // wa.me link for exactly this.
    if (!EMAIL_RE.test(email)) continue;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: "Dina's Studio <orders@dinasstudio.com>",
          to: [email],
          subject: `${product.name} is back in stock`,
          html
        })
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      notified.push(r.id);
    } catch (e) {
      // One bad address must not stop the rest of the list being told.
      console.error('Restock email failed for request', r.id, '-', e.message);
    }
  }

  // Marked only after a successful send, so a failure leaves the request in the
  // queue for the next time rather than silently dropping someone.
  if (notified.length) {
    try {
      const res = await rest(`restock_requests?id=in.(${notified.join(',')})`, {
        method: 'PATCH',
        body: JSON.stringify({ notified_at: new Date().toISOString() })
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      // The emails are already out; saying so twice is better than not at all,
      // but this is worth seeing in the logs.
      console.error('Could not mark requests notified:', e.message);
    }
  }

  const phoneOnly = waiting.length - notified.length;
  console.log('Restocked', product.id, '- emailed', notified.length, ', left for WhatsApp', phoneOnly);
  return new Response(`Emailed ${notified.length}, ${phoneOnly} to message`, { status: 200 });
}
