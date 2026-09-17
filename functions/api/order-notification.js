// Cloudflare Pages route: POST /api/order-notification
// Every file in functions/ becomes a route, so this holds only the adapter; the
// logic and its test live in lib/.
import { handle } from '../../lib/order-notification.js';

export const onRequest = ({ request, env }) => handle(request, env);
