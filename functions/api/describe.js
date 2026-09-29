// Cloudflare Pages route: POST /api/describe
// Every file in functions/ becomes a route, so this holds only the adapter; the
// logic and its test live in lib/.
import { handle } from '../../lib/describe.js';

export const onRequest = ({ request, env }) => handle(request, env);
