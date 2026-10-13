// The main banner (slide one) as the owner set it in the admin panel's Banners
// tab, written into index.html before it is sent. Doing it here rather than in
// the browser means the banner paints with no script, with no flash of the
// default text, and the owner's headline is what Google reads.
//
// Shared by GET / (functions/index.js) and GET /p/<slug> (lib/product-page.js),
// which both serve the same shell. public/js/app.js builds the same markup to
// update the slide in place after the owner saves; the class names below are
// what its CSS and that code rely on.
import { FALLBACK_URL, FALLBACK_KEY } from './product-page.js';

export const HERO_DEFAULTS = {
  eyebrow: 'new season',
  title: 'Wrapped in softness, styled with heart',
  text: 'Matching sets, abayas & kimonos designed for effortless elegance — made to move with you.'
};

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const ARROW = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>`;

const filled = v => (typeof v === 'string' && v.trim()) ? v.trim() : '';

export function heroFromRow(row) {
  const r = row || {};
  const image = filled(r.hero_image);
  return {
    eyebrow: filled(r.hero_eyebrow) || HERO_DEFAULTS.eyebrow,
    title: filled(r.hero_title) || HERO_DEFAULTS.title,
    text: filled(r.hero_text) || HERO_DEFAULTS.text,
    // Only an https URL becomes an <img src>; anything else is ignored rather
    // than written into the page.
    image: /^https:\/\//.test(image) ? image : ''
  };
}

// Banner photos are stored as a -lg/-sm pair, like product photos.
export function smallVariant(url) {
  return /-lg\.webp($|\?)/.test(url) ? url.replace('-lg.webp', '-sm.webp') : null;
}

export function renderHeroSlide(hero) {
  const sm = hero.image && smallVariant(hero.image);
  const photo = hero.image
    ? `<img class="hero-photo" src="${esc(hero.image)}"${sm ? ` srcset="${esc(sm)} 800w, ${esc(hero.image)} 1600w" sizes="(max-width:640px) 100vw, 60vw"` : ''} alt="" fetchpriority="high">`
    : '';
  return `
          <div class="hero hero-slide${hero.image ? ' has-photo' : ''}">
            ${photo}
            <div class="hero-copy">
            <div class="eyebrow">${esc(hero.eyebrow)}</div>
            <h1>${esc(hero.title)}</h1>
            <p>${esc(hero.text)}</p>
            <button class="hero-cta" onclick="shopFromHero(false)">
              Shop the collection
              ${ARROW}
            </button>
            </div>
          </div>
          `;
}

export function applyHero(html, hero) {
  const re = /<!--hero:start-->[\s\S]*?<!--hero:end-->/;
  if (!re.test(html)) throw new Error('hero markers not found in index.html');
  return html.replace(re, () => `<!--hero:start-->${renderHeroSlide(hero)}<!--hero:end-->`);
}

// null when the settings can't be read (Supabase down, or banner-settings.sql
// not run yet, so the columns don't exist): callers serve the page unchanged.
export async function fetchHero(env = {}) {
  const base = env.SUPABASE_URL || FALLBACK_URL;
  const key = env.SUPABASE_ANON_KEY || FALLBACK_KEY;
  try {
    const res = await fetch(`${base}/rest/v1/shop_settings?id=eq.1&select=hero_eyebrow,hero_title,hero_text,hero_image`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
    return heroFromRow((await res.json())[0]);
  } catch (e) {
    console.error('Could not load banner settings -', e.message);
    return null;
  }
}

const htmlResponse = (body, cache) => new Response(body, {
  status: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache }
});

export async function handleHome(request, env = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const url = new URL(request.url);
  const shell = await (await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), { method: 'GET' }))).text();
  const hero = await fetchHero(env);
  if (!hero) return htmlResponse(shell, 'no-store');
  return htmlResponse(applyHero(shell, hero), 'public, max-age=300, stale-while-revalidate=3600');
}
