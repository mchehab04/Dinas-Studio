-- ============================================================
-- Make place_order the ONLY way to create an order.
--
-- ⚠ Run this LAST — only once the new checkout is live on dinasstudio.com.
-- The old deployed client inserts into orders directly; revoking before that
-- deploy breaks checkout for every customer until the next one.
--
-- To confirm the new client is live first: place a real test order. If it
-- succeeds and the piece flips to Sold Out by itself, place_order is in use.
-- ============================================================

-- Both are needed: the grant is the door, the policy is the lock on it.
drop policy if exists "orders_insert_own" on public.orders;
revoke insert on public.orders from authenticated;

-- Customers keep reading their own orders; admins keep updating status.
-- place_order is security definer, so it still inserts.
