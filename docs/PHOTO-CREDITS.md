# Landing-page photography credits (I-7, 2026-11)

Every image on the marketing landing page (`index.html`) is self-hosted under
`images/` as WebP (or SVG for vector art). No remote image URLs are referenced
from the page. Each file is listed below with what is known about its source.

> Provenance note: these are assets already in the repository. The licence,
> author and retrieval date for some were not recorded at capture time. Those
> fields are marked **CONFIRM** — the owner must verify the licence permits
> commercial use and modification before the page ships, or replace the file
> with a known-licence image. Do not invent a licence.

| File | Used on | Format | ~Size | Source / photographer | Licence | Date retrieved |
|---|---|---|---|---|---|---|
| `hero-crane-sky.webp` | Hero background (`#top`) | WebP 1600×900 | 36 KB | Owner-supplied | **CONFIRM** (must allow commercial use + modification) | — |
| `site-overview-clean.webp` | Photo band "whole job from above" | WebP 1600×900 | 124 KB | Owner-supplied | **CONFIRM** | — |
| `finished-interior-living.webp` | Interior photo band | WebP 1200×896 | 106 KB | Owner-supplied | **CONFIRM** | — |
| `hero-landing.webp` | (retired from hero; kept on disk) | WebP | 80 KB | Owner-supplied | **CONFIRM** | — |
| `site-blueprint.webp` | (retired from photo band; kept on disk) | WebP 1600×900 | 120 KB | Owner-supplied | **CONFIRM** | — |
| `hero-globe-poster.svg` | Hero globe poster (vector) | SVG | — | First-party illustration | First-party (no third-party licence) | — |
| `office-project-desk.webp` | Used on `about.html` / contact | WebP | 56 KB | Owner-supplied | **CONFIRM** | — |
| `contact-desk.webp` | Used on `contact.html` | WebP | 68 KB | Owner-supplied | **CONFIRM** | — |
| `completed-kitchen.webp` | Used on `about.html` | WebP | 64 KB | Owner-supplied | **CONFIRM** | — |

## Constraints applied (T-PHOTOS gate)

- All images are local (`images/...`); no `http(s)://` image references on the page.
- Each is `< 150 KB` at its largest served size (largest is `site-overview-clean.webp` at 124 KB).
- Every photo carries `width` + `height` (no layout shift) and descriptive `alt`.
- Photo-band and below-the-fold photos use `loading="lazy"`; the hero uses
  `fetchpriority="high"` as the LCP element.
- A dark gradient overlay (`.hero-overlay` / `.pb-overlay`) keeps overlaid text
  at >= 4.5:1 contrast.
- No identifiable people, brand logos, or third-party trademarks appear in the
  chosen frames (verify per image before ship — **CONFIRM** items above).

## Action required before merge

1. Confirm the licence of every **CONFIRM** image permits commercial use and
   modification, or swap in a known-licence (e.g. Unsplash/Pexels CC0 or
   a purchased licence) photograph of skyscrapers / large construction works.
2. Record photographer + retrieval date in the table above for each confirmed image.
