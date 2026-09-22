// Cloudflare Pages route: GET /sitemap.xml
// Generated rather than static, so a new piece is discoverable without anyone
// remembering to edit a file. The static public/sitemap.xml was deleted with
// this, so there is no question about which one answers.
import { slugify } from '../lib/product-page.js';

const FALLBACK_KEY = 'sb_publishable_OU2KGlmbJd2yLqJEL4vZUA_HYunKZ-K';
const FALLBACK_URL = 'https://ciwahcmsjcywakwhtsle.supabase.co';

export async function onRequest({ request, env }) {
  const origin = new URL(request.url).origin;
  const base = env.SUPABASE_URL || FALLBACK_URL;
  const key = env.SUPABASE_ANON_KEY || FALLBACK_KEY;

  let products = [];
  try {
    const res = await fetch(`${base}/rest/v1/products?select=id,name&order=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (res.ok) products = await res.json();
    else console.error('Sitemap product read failed:', res.status);
  } catch (e) {
    // A sitemap listing only the homepage beats a 500: the crawler keeps the
    // one URL it already had rather than recording the sitemap as broken.
    console.error('Sitemap product read failed:', e.message);
  }

  const urls = [origin + '/', ...products.map(p => `${origin}/p/${slugify(p.name)}-${p.id}`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>\n    <loc>${u}</loc>\n  </url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
