// Cloudflare Pages route: GET /p/<slug>-<id>
// Every file in functions/ becomes a route, so this holds only the adapter; the
// logic and its test live in lib/.
import { handle } from '../../lib/product-page.js';

export const onRequest = ({ request, env }) => handle(request, env);
