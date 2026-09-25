// Receives a Supabase Database Webhook on INSERT into public.orders and emails
// the order through Resend.
//
// It runs from the database rather than the browser on purpose: a send fired
// from placeOrder() would be skipped exactly when it matters most — the tab
// closed right after paying, the connection dropped, or the API written to
// directly. By the time this runs the order has already committed, so a failure
// here can never block or undo a sale.
//
// No npm dependency: fetch, Request and Response are globals in both the
// Cloudflare Workers runtime and Node 18+, and Resend is a plain HTTPS call.
//
// Lives outside functions/ on purpose. Cloudflare turns every file in that
// directory into a route, so the core stays here and functions/api/ holds only
// a thin adapter — which also lets the test call it directly with a plain env.

const money = n => `AED ${Number(n).toFixed(2)}`;
// Amounts are stored in dirhams; Lebanon customers are shown dollars only, at
// the same fixed peg as the storefront.
const AED_PER_USD = 3.6725;
const usd = n => `$${(Number(n) / AED_PER_USD).toFixed(2)}`;

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const COUNTRIES = {
  AE: { name: 'United Arab Emirates', delivery: '1–2 business days' },
  // Delivery outside these areas is agreed on WhatsApp, so nothing is charged.
  LB: { name: 'Lebanon', delivery: '3–5 business days', usdOnly: true, pricedAreas: ['Beirut', 'Mount Lebanon'] }
};
// Orders predating Lebanon support carry no country and stored the region under
// `emirate`; both fall back rather than rendering blank.
const countryOf = a => COUNTRIES[a.country] || COUNTRIES.AE;
const regionOf = a => a.region || a.emirate || '';

// Nothing charged means delivery agreed on WhatsApp or, on an order from before
// delivery was priced by area, free delivery.
function deliveryCell(o, fmt) {
  if (Number(o.shipping) > 0) return fmt(o.shipping);
  const a = o.shippingAddress || {};
  const { pricedAreas } = countryOf(a);
  return pricedAreas && !pricedAreas.includes(regionOf(a)) ? 'Arranged on WhatsApp' : 'Free';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// showDiscount is for the owner's copy only. place_order records fullPrice and
// discountPercent beside each charged total, and the copy used to reconcile
// takings should say what a sale gave away; the customer sees what they paid.
// Orders placed before discounts existed carry no fullPrice and show one price.
// fmt is how amounts are written: dirhams, or dollars for a Lebanon customer.
function itemsTable(o, showDiscount = false, fmt = money) {
  const rows = (o.items || []).map(i => {
    const off = Number(i.discountPercent) > 0 && Number(i.fullPrice) > Number(i.total);
    const was = showDiscount && off
      ? `<br><span style="color:#8A6B63;font-size:11.5px;">was ${money(i.fullPrice)} · −${esc(i.discountPercent)}%</span>`
      : '';
    return `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(i.name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(i.size)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${esc(i.qty)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${fmt(i.total)}${was}</td>
    </tr>`;
  }).join('');

  return `
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="text-align:left;color:#8A6B63;">
          <th style="padding:6px 10px;">Piece</th>
          <th style="padding:6px 10px;">Size</th>
          <th style="padding:6px 10px;text-align:center;">Qty</th>
          <th style="padding:6px 10px;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <table style="margin-top:14px;font-size:14px;width:100%;">
      <tr><td style="color:#8A6B63;">Subtotal</td><td style="text-align:right;">${fmt(o.subtotal)}</td></tr>
      <tr><td style="color:#8A6B63;">Delivery</td><td style="text-align:right;">${deliveryCell(o, fmt)}</td></tr>
      <tr><td style="font-weight:700;padding-top:6px;">Total</td>
          <td style="text-align:right;font-weight:700;color:#A63A3A;padding-top:6px;">${fmt(o.total)}</td></tr>
    </table>`;
}

const shell = inner =>
  `<div style="font-family:system-ui,-apple-system,sans-serif;color:#3B2323;max-width:560px;">${inner}</div>`;

// The shop's contact details in one place. The storefront footer carries the
// same number and links — if one changes, change both.
const CONTACT = {
  phone: '+971 58 599 5315',
  whatsapp: 'https://wa.me/971585995315',
  instagram: 'https://instagram.com/dinasstudio1',
  site: 'https://dinasstudio.com'
};

// Signs off the customer's copy. The owner's is an internal notification and
// doesn't need one.
const signature = () => `
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #EFD6D9;font-size:13px;line-height:1.7;">
      <div style="font-weight:700;color:#A63A3A;font-size:15px;">Dina's Studio</div>
      <div style="color:#8A6B63;font-size:12.5px;">Modest fashion, handmade to move with you</div>
      <div style="margin-top:10px;color:#3B2323;">
        WhatsApp or call
        <a href="${CONTACT.whatsapp}" style="color:#A63A3A;text-decoration:none;font-weight:700;">${CONTACT.phone}</a><br>
        <a href="${CONTACT.site}" style="color:#A63A3A;text-decoration:none;">dinasstudio.com</a>
        &nbsp;·&nbsp;
        <a href="${CONTACT.instagram}" style="color:#A63A3A;text-decoration:none;">Instagram</a>
      </div>
    </div>`;

// The owner's copy is a fulfilment view: it leads with the phone, because that
// is how transfer details get sent.
function buildOwnerHtml(o) {
  const c = o.customer || {};
  const a = o.shippingAddress || {};
  return shell(`
    <h2 style="color:#A63A3A;margin:0 0 4px;">New order ${esc(o.id)}</h2>
    <p style="margin:0 0 18px;color:#8A6B63;font-size:13px;">
      ${esc(o.displayDate || '')} · ${esc(o.status || '')} · ${esc(o.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Bank Transfer')}
    </p>

    <h3 style="font-size:14px;margin:0 0 6px;">Customer</h3>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      ${esc(c.name)}<br>
      ${esc(c.email)}<br>
      <a href="https://wa.me/${esc(String(c.phone).replace(/[^0-9]/g, ''))}" style="color:#A63A3A;text-decoration:none;font-weight:700;">${esc(c.phone)}</a>
    </p>

    <h3 style="font-size:14px;margin:0 0 6px;">Deliver to</h3>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      ${esc(regionOf(a))}, ${esc(countryOf(a).name)}<br>
      ${esc(a.address)}
      ${a.notes ? `<br><em style="color:#8A6B63;">Notes: ${esc(a.notes)}</em>` : ''}
    </p>

    <h3 style="font-size:14px;margin:0 0 6px;">Items</h3>
    ${itemsTable(o, true)}`);
}

// The customer's copy confirms rather than reports. The "what happens next"
// line matters most: a transfer customer has just ordered and been told nothing
// about how to pay.
function buildCustomerHtml(o) {
  const c = o.customer || {};
  const a = o.shippingAddress || {};
  const next = o.paymentMethod === 'cod'
    ? `Pay the courier in cash or by card when your order arrives. Estimated delivery is ${countryOf(a).delivery}.`
    : `We'll message you on WhatsApp at <strong>${esc(c.phone)}</strong> with the transfer details. Your pieces are reserved until payment arrives, and delivery takes around ${countryOf(a).delivery} from then.`;

  return shell(`
    <h2 style="color:#A63A3A;margin:0 0 4px;">Thank you${c.name ? `, ${esc(String(c.name).split(' ')[0])}` : ''}!</h2>
    <p style="margin:0 0 18px;color:#8A6B63;font-size:14px;">
      We've got your order and we're preparing it with care.
    </p>

    <div style="background:#FDF3F0;border:1px solid #F3C7CC;border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:13.5px;line-height:1.55;">
      <strong>What happens next:</strong> ${next}
    </div>

    <p style="margin:0 0 16px;font-size:14px;">
      <span style="color:#8A6B63;">Order</span> <strong>${esc(o.id)}</strong>
    </p>

    <h3 style="font-size:14px;margin:0 0 6px;">Delivering to</h3>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      ${esc(regionOf(a))}, ${esc(countryOf(a).name)}<br>
      ${esc(a.address)}
    </p>

    <h3 style="font-size:14px;margin:0 0 6px;">Your order</h3>
    ${itemsTable(o, false, countryOf(a).usdOnly ? usd : money)}

    <p style="margin:20px 0 0;font-size:12.5px;color:#8A6B63;line-height:1.6;">
      Something not right? Reply to this email or message us on WhatsApp — both reach us.
    </p>
    ${signature()}`);
}

// env is passed in rather than read from process.env, which Workers don't have.
export async function handle(req, env = {}) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { RESEND_API_KEY, NOTIFY_TO, WEBHOOK_SECRET } = env;
  const missing = Object.entries({ RESEND_API_KEY, NOTIFY_TO, WEBHOOK_SECRET })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error('Missing environment variables:', missing.join(', '));
    return new Response('Not configured', { status: 500 });
  }

  // The function URL is public. Without this, anyone who found it could post
  // fabricated orders and bury a real one in the noise.
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    console.warn('Rejected webhook: bad or missing secret');
    return new Response('Unauthorized', { status: 401 });
  }

  let order;
  try {
    const body = await req.json();
    order = body.record;
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (!order || !order.id) return new Response('No order in payload', { status: 400 });

  const owners = NOTIFY_TO.split(',').map(s => s.trim()).filter(Boolean);

  const send = async payload => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: "Dina's Studio <orders@dinasstudio.com>", ...payload })
    });
    // Deliberately logs status only — never the customer record.
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };

  // The owner's notification is the one that costs money if it goes missing, so
  // it sends first and is the only one whose failure is reported to Supabase.
  try {
    await send({
      to: owners,
      subject: `New order ${order.id} — ${money(order.total)}`,
      html: buildOwnerHtml(order)
    });
  } catch (e) {
    console.error('Owner notification failed:', e.message);
    return new Response('Send failed', { status: 502 });
  }

  // Best effort: a bounced customer address must never mask a real order.
  const customerEmail = String((order.customer || {}).email || '').trim();
  if (EMAIL_RE.test(customerEmail)) {
    try {
      await send({
        to: [customerEmail],
        reply_to: owners[0],
        subject: `Your Dina's Studio order ${order.id}`,
        html: buildCustomerHtml(order)
      });
    } catch (e) {
      console.error('Customer confirmation failed for', order.id, '-', e.message);
    }
  } else {
    console.warn('No usable customer email on order', order.id);
  }

  console.log('Notified for order', order.id);
  return new Response('OK', { status: 200 });
}
