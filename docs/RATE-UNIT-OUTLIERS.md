# Rate-Unit Outliers (G-1 / T-RATEUNIT)

This file is the **allow-list** for `tools/qa-rate-unit.cjs` F2. It lists
rate-book rows whose imperial and metric rates do **not** reconcile within
1.5% through the unit conversion in `js/rateunits.js`.

The gate FAILS if a row is out of tolerance and **not** listed here, or if a
row is listed here but is now back in tolerance (the list must track reality).

## Why a row lands here

These are first-party book figures (`src/data/ratebook.js`, generated from
`RATE-BOOK-2025-2027-FULL.md`). The two sides were set independently and
round to slightly different money. They are NOT the G-1 bug class (a
per-m² rate pricing a per-ft² quantity, ~10.76× wrong) — they are small
(< 5%) genuine book discrepancies the owner must decide on. The gate's job
is to keep them visible, not to silently pass them.

## Documented outliers

ref: Painting #5
  - imperial: Ft.Run @ 9  (9 / 0.3048 = 29.53 /m)
  - metric:   m @ 31
  - delta: 4.75%  (metric priced ~4.75% high vs the foot rate)
  - status: first-party figure; owner to confirm whether 31/m or 29.5/m is intended.

ref: Painting #6
  - imperial: Ft.Run @ 9
  - metric:   m @ 31
  - delta: 4.75%  (same paired rate as Painting #5)
  - status: first-party figure; owner to confirm.

## How to add / remove

- A new out-of-tolerance row appears in the gate's `RATE-UNIT outliers`
  stderr dump. Add a block headed by the row's ref (format `Trade #n`) here
  with the delta and a status line.
- If the book is corrected so a listed row comes back within 1.5%, delete
  its block (the gate will flag a stale allow-list entry).
