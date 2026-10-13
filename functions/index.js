// Cloudflare Pages route: GET /
// Every file in functions/ becomes a route, so this holds only the adapter; the
// logic and its test live in lib/.
import { handleHome } from '../lib/hero.js';

export const onRequest = ({ request, env }) => handleHome(request, env);
