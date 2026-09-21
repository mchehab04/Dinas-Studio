-- ============================================================
-- Record when an order was actually paid for.
--
-- Safe to run any time: it only adds a nullable column. Orders already in the
-- table come back null, i.e. unpaid, so mark the ones you have been paid for
-- once after running this.
--
-- A timestamp rather than a boolean — it answers "is it paid" just as well
-- (paidAt is not null) and also answers when, at no extra cost.
--
-- Payment is deliberately separate from status. Status tracks where the parcel
-- is; with bank transfer the money arrives before shipping and with cash on
-- delivery it arrives at the door, so no fulfilment status can stand in for it.
-- ============================================================

alter table public.orders add column if not exists "paidAt" timestamptz;

-- No new policy needed: orders_update_admin_only already limits updates to
-- admins, and place_order leaves paidAt null on insert.
