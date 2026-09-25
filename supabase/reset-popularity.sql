-- ============================================================
-- One-off, 2026-09-25: replaces the made-up popularity scores from
-- the original template with ones based on what has actually sold.
-- Run once in the Supabase SQL Editor. "Popularity" is the shop's
-- default sort, highest score first.
--
--   100  sold out, so recently bought
--         2  Dark Green Cotton & Chiffon Set
--         7  Silk Jacquard Set — Light Blue
--         8  Silk Jacquard Set — Emerald Dot
--         9  Silk Jacquard Set — Olive Medallion
--        11  Silk Satin Print Set
--    60  6  Silk Jacquard Set — Offwhite: the last of the line
--           three of the sold pieces came from
--    50  similar to a sold piece
--         1  Black Cotton Set, 18 Grey Cotton with Vintage Buttons:
--            relaxed cotton sets, like 2
--        10  Polka Dot Linen Set: S-M and the same price as 11
--     0  everything else, and every piece added from now on
--
-- One statement, so the products webhook fires once per piece; the
-- restock email ignores it, since no piece's stock changes.
-- ============================================================
update public.products set pop = case
  when id in (2, 7, 8, 9, 11) then 100
  when id = 6 then 60
  when id in (1, 10, 18) then 50
  else 0
end;
