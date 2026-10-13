// Run: node tests/hero.test.mjs
//
// Runs against the REAL public/index.html, so a hero that changes shape fails
// here rather than silently serving the default banner forever.
import { readFile } from 'node:fs/promises';
import { HERO_DEFAULTS, heroFromRow, renderHeroSlide, applyHero, handleHome } from '../lib/hero.js';

const SHELL = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
const slideOf = html => /<!--hero:start-->([\s\S]*?)<!--hero:end-->/.exec(html)[1];
const PHOTO = 'https://proj.supabase.co/storage/v1/object/public/product-images/banners/abc-lg.webp';

// --- settings
const empty = heroFromRow({});
check('empty settings take every default', empty.title === HERO_DEFAULTS.title && empty.eyebrow === HERO_DEFAULTS.eyebrow && empty.text === HERO_DEFAULTS.text && empty.image === '');
check('null row takes the defaults', heroFromRow(null).title === HERO_DEFAULTS.title);
check('blank text takes the default', heroFromRow({ hero_title: '   ' }).title === HERO_DEFAULTS.title);
check('a non-https photo is ignored', heroFromRow({ hero_image: 'javascript:alert(1)' }).image === '');

// --- the shell carries the markers, and today's banner is the default
check('index.html has the hero markers', /<!--hero:start-->[\s\S]*<!--hero:end-->/.test(SHELL));
check('the default slide matches what index.html ships',
  slideOf(applyHero(SHELL, empty)).replace(/\s+/g, ' ').includes('Wrapped in softness, styled with heart'));
check('no photo -> no photo element and no has-photo class',
  !/hero-photo/.test(renderHeroSlide(empty)) && !/has-photo/.test(renderHeroSlide(empty)));

// --- the owner's text and photo
const own = heroFromRow({ hero_eyebrow: 'autumn', hero_title: 'Made by hand, one at a time', hero_text: 'New pieces every week.', hero_image: PHOTO });
const slide = slideOf(applyHero(SHELL, own));
check('the headline is the <h1>', /<h1>Made by hand, one at a time<\/h1>/.test(slide));
check('the small heading and line are used', slide.includes('>autumn<') && slide.includes('New pieces every week.'));
check('the photo is an <img> with both sizes',
  slide.includes(`src="${PHOTO}"`) && slide.includes(PHOTO.replace('-lg.webp', '-sm.webp') + ' 800w'));
check('the slide is marked has-photo', /class="hero hero-slide has-photo"/.test(slide));
check('the photo loads first, decoratively', /fetchpriority="high"/.test(slide) && /alt=""/.test(slide));
check('the button still opens the collection', slide.includes('onclick="shopFromHero(false)"'));
// The About view has its own <h1> in the same file; the banner holds exactly one.
check('the banner keeps one <h1>', (slide.match(/<h1[\s>]/g) || []).length === 1);

// --- hostile text cannot escape
const bad = slideOf(applyHero(SHELL, heroFromRow({ hero_title: '"><script>alert(1)</script>', hero_text: '<img src=x onerror=alert(1)>' })));
check('a hostile headline is escaped', !bad.includes('<script>') && bad.includes('&lt;script&gt;'));
check('a hostile line is escaped', !bad.includes('<img src=x') && bad.includes('&lt;img'));

// --- missing markers fail loudly
let threw = false;
try { applyHero('<html></html>', empty); } catch { threw = true; }
check('a shell without markers throws', threw);

// --- the route
let reply = { ok: true, body: [{ hero_title: 'From the route', hero_image: PHOTO }] };
let fetched = [];
globalThis.fetch = async url => {
  fetched.push(String(url));
  return reply.ok ? new Response(JSON.stringify(reply.body), { status: 200 }) : new Response('boom', { status: 400 });
};
const env = { ASSETS: { fetch: async () => new Response(SHELL, { status: 200 }) } };
const get = (method = 'GET') => handleHome(new Request('https://dinasstudio.com/', { method }), env);

const ok = await get();
const okBody = await ok.text();
check('/ returns 200 html', ok.status === 200 && ok.headers.get('content-type').includes('text/html'));
check('/ carries the saved headline', okBody.includes('<h1>From the route</h1>'));
check('/ is cached for 5 minutes', /max-age=300/.test(ok.headers.get('cache-control')));
check('/ reads only the banner columns of row 1',
  fetched[0].includes('shop_settings?id=eq.1') && fetched[0].includes('select=hero_eyebrow,hero_title,hero_text,hero_image'));

reply = { ok: false };
const down = await get();
const downBody = await down.text();
check('Supabase down (or columns missing) -> today\'s page', down.status === 200 && downBody === SHELL);
check('and it is not cached', down.headers.get('cache-control') === 'no-store');

reply = { ok: true, body: [{}] };
check('a row with no banner fields -> the default banner', (await (await get()).text()).includes('Wrapped in softness, styled with heart'));

check('POST is rejected', (await get('POST')).status === 405);
