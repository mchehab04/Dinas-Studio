// Serves /p/<slug>-<id>: the ordinary shop shell with its head rewritten for one
// piece, plus a marker telling the app which piece to open.
//
// Rewriting the shell rather than rendering a second page keeps one template
// and one design. What matters is that the tags are right without JavaScript:
// social scrapers never run it, so a WhatsApp or Instagram preview is decided
// entirely by what this function returns.
//
// Lives outside functions/ for the same reason as the notification logic —
// every file there becomes a route — and so the test can call it under plain
// Node with a stubbed asset store.

// Public by design and already shipped in public/js/supabaseClient.js. Used as
// a fallback so this route needs no setup of its own; set SUPABASE_ANON_KEY to
// override it.
const FALLBACK_KEY = 'sb_publishable_OU2KGlmbJd2yLqJEL4vZUA_HYunKZ-K';
const FALLBACK_URL = 'https://ciwahcmsjcywakwhtsle.supabase.co';

export function slugify(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'piece';
}

export const productPath = p => `/p/${slugify(p.name)}-${p.id}`;

// The trailing id resolves the piece; the words in front are decoration. That
// is what lets a piece be renamed without breaking a link already shared.
export function idFromSlug(slug) {
  const m = /-(\d+)$/.exec(String(slug || ''));
  return m ? Number(m[1]) : null;
}

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Inside a <script> the HTML parser stops at the first "</script...", so that
// is the one sequence JSON must not contain. < is escaped for good measure.
const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c');

function description(p) {
  const own = String(p.desc || '').replace(/\s+/g, ' ').trim();
  const base = own || `${p.name} — handmade ${String(p.cat || '').toLowerCase()} from Dina's Studio.`;
  const tail = ` AED ${Number(p.price).toFixed(0)} · delivered across the UAE and Lebanon.`;
  // Search engines show roughly 155 characters; anything past that is wasted.
  const room = 155 - tail.length;
  return (base.length > room ? base.slice(0, room - 1).trimEnd() + '…' : base) + tail;
}

function jsonLd(p, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: String(p.desc || '').replace(/\s+/g, ' ').trim() || undefined,
    image: (p.images || []).length ? p.images : undefined,
    category: p.cat || undefined,
    brand: { '@type': 'Brand', name: "Dina's Studio" },
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'AED',
      price: Number(p.price).toFixed(2),
      availability: p.stock === 'out'
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock'
    }
  };
}

// Swaps the head's shop-wide tags for this piece's. Each pattern targets a tag
// that exists in public/index.html today; tests/product-page.test.mjs runs this
// against the real file, so a head that changes shape fails there rather than
// in production.
export function renderHead(html, product, origin) {
  const url = origin + productPath(product);
  const title = `${product.name} | Dina's Studio`;
  const desc = description(product);
  // Social scrapers won't resolve a relative og:image. Live photos are already
  // absolute Supabase URLs, but a seeded row carries a repo-relative path.
  const first = (product.images && product.images[0]) || '';
  const image = !first ? `${origin}/Logo.jpeg`
    : /^https?:\/\//.test(first) ? first
    : origin + (first.startsWith('/') ? '' : '/') + first;

  const swaps = [
    [/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`],
    [/<meta name="description"[\s\S]*?>/, `<meta name="description" content="${esc(desc)}">`],
    [/<meta property="og:title"[\s\S]*?>/, `<meta property="og:title" content="${esc(title)}">`],
    [/<meta property="og:description"[\s\S]*?>/, `<meta property="og:description" content="${esc(desc)}">`],
    [/<meta property="og:image"[\s\S]*?>/, `<meta property="og:image" content="${esc(image)}">`],
    [/<meta property="og:url"[\s\S]*?>/, `<meta property="og:url" content="${esc(url)}">`],
    [/<meta property="og:type"[\s\S]*?>/, `<meta property="og:type" content="product">`],
    [/<link rel="canonical"[\s\S]*?>/, `<link rel="canonical" href="${esc(url)}">`]
  ];

  let out = html;
  for (const [pattern, replacement] of swaps) {
    if (!pattern.test(out)) throw new Error(`head tag not found: ${pattern}`);
    out = out.replace(pattern, replacement);
  }

  // The Organization block stays: it describes the shop, not this piece.
  const extra =
    `<script type="application/ld+json">${jsonForScript(jsonLd(product, url))}</script>\n` +
    `<script>window.__OPEN_PRODUCT__ = ${Number(product.id)};</script>\n</head>`;
  return out.replace('</head>', extra);
}

const htmlResponse = (body, status, cache) => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache }
});

export async function handle(request, env = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const asset = path => env.ASSETS.fetch(new Request(new URL(path, url.origin), { method: 'GET' }));
  const notFound = async () => {
    const res = await asset('/404.html');
    return htmlResponse(await res.text(), 404, 'public, max-age=300');
  };

  const id = idFromSlug(url.pathname.replace(/^\/p\//, ''));
  if (!id) return notFound();

  const base = env.SUPABASE_URL || FALLBACK_URL;
  const key = env.SUPABASE_ANON_KEY || FALLBACK_KEY;

  let product;
  try {
    // Products are world-readable, so the publishable key is all this needs —
    // no service-role access anywhere near a public page.
    const res = await fetch(`${base}/rest/v1/products?id=eq.${id}&select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
    product = (await res.json())[0];
  } catch (e) {
    console.error('Could not load product', id, '-', e.message);
    // The shop still works, so fall back to the ordinary page rather than an
    // error: a visitor gets the storefront, and a crawler gets a 200 it can
    // come back to instead of a failure it might remember.
    const shell = await asset('/index.html');
    return htmlResponse(await shell.text(), 200, 'no-store');
  }

  if (!product) return notFound();

  // One piece, one indexable URL: anything else redirects to the canonical form.
  const canonical = productPath(product);
  if (url.pathname !== canonical) {
    return new Response(null, { status: 301, headers: { Location: canonical + url.search } });
  }

  const shell = await asset('/index.html');
  const html = renderHead(await shell.text(), product, url.origin);
  // Five minutes so a price or stock change surfaces quickly, with a stale copy
  // served while it refreshes rather than 17 Supabase reads per crawl.
  return htmlResponse(html, 200, 'public, max-age=300, stale-while-revalidate=3600');
}
