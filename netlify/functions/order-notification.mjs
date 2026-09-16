// Receives a Supabase Database Webhook on INSERT into public.orders and emails
// the order through Resend.
//
// It runs from the database rather than the browser on purpose: a send fired
// from placeOrder() would be skipped exactly when it matters most — the tab
// closed right after paying, the connection dropped, or the API written to
// directly. By the time this runs the order has already committed, so a failure
// here can never block or undo a sale.
//
// No npm dependency: Node 18+ has global fetch and Resend is a plain HTTPS call,
// which keeps the project's no-build-step property intact.

const money = n => `AED ${Number(n).toFixed(2)}`;

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const COUNTRY_NAMES = { AE: 'United Arab Emirates', LB: 'Lebanon' };

function buildHtml(o) {
  const c = o.customer || {};
  const a = o.shippingAddress || {};
  // Orders predating Lebanon support have no country and stored the region
  // under `emirate`.
  const country = COUNTRY_NAMES[a.country] || COUNTRY_NAMES.AE;
  const region = a.region || a.emirate || '';

  const rows = (o.items || []).map(i => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(i.name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(i.size)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${esc(i.qty)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${money(i.total)}</td>
    </tr>`).join('');

  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;color:#3B2323;max-width:560px;">
    <h2 style="color:#A63A3A;margin:0 0 4px;">New order ${esc(o.id)}</h2>
    <p style="margin:0 0 18px;color:#8A6B63;font-size:13px;">
      ${esc(o.displayDate || '')} · ${esc(o.status || '')} · ${esc(o.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Bank Transfer')}
    </p>

    <h3 style="font-size:14px;margin:0 0 6px;">Customer</h3>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      ${esc(c.name)}<br>
      ${esc(c.email)}<br>
      <strong>${esc(c.phone)}</strong>
    </p>

    <h3 style="font-size:14px;margin:0 0 6px;">Deliver to</h3>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      ${esc(region)}, ${esc(country)}<br>
      ${esc(a.address)}
      ${a.notes ? `<br><em style="color:#8A6B63;">Notes: ${esc(a.notes)}</em>` : ''}
    </p>

    <h3 style="font-size:14px;margin:0 0 6px;">Items</h3>
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
      <tr><td style="color:#8A6B63;">Subtotal</td><td style="text-align:right;">${money(o.subtotal)}</td></tr>
      <tr><td style="color:#8A6B63;">Delivery</td><td style="text-align:right;">${Number(o.shipping) === 0 ? 'Free' : money(o.shipping)}</td></tr>
      <tr><td style="font-weight:700;padding-top:6px;">Total</td>
          <td style="text-align:right;font-weight:700;color:#A63A3A;padding-top:6px;">${money(o.total)}</td></tr>
    </table>
  </div>`;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { RESEND_API_KEY, NOTIFY_TO, WEBHOOK_SECRET } = process.env;
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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: "Dina's Studio <orders@dinasstudio.com>",
      to: NOTIFY_TO.split(',').map(s => s.trim()).filter(Boolean),
      subject: `New order ${order.id} — ${money(order.total)}`,
      html: buildHtml(order)
    })
  });

  if (!res.ok) {
    // Deliberately logs status only — never the customer record.
    console.error('Resend rejected the send:', res.status, await res.text());
    return new Response('Send failed', { status: 502 });
  }

  console.log('Notified for order', order.id);
  return new Response('OK', { status: 200 });
};
