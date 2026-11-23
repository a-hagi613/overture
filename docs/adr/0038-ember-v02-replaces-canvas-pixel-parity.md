---
status: accepted
---

# Ember v0.2 rebuild supersedes pre-Ember canvas pixel parity

Amends ADR 0021 (`docs/adr/0021-canvas-is-the-wireframe.md`).

The web workspace was rebuilt onto the Ember v0.2 design system using Tailwind CSS v4 tokens and
accessible Radix/shadcn UI primitives under `src/web/components/ui/*` (PR #501). That rebuild
updated card radii (`rounded-xl`, `12px`), spacing, route structure (`/home`, consolidated
`/profile/{resume,details,preferences,account,billing}`), and component markup beyond the retired
pre-Ember PNG/JSON exports in `design/reference/`.

## Decision

1. **Token and structural compliance replaces pre-Ember pixel diffs.** `overture/no-raw-design-styles`
   enforces Ember palette/surface tokens at lint time, while `layout-guards-*.test.ts`,
   `interactive-*.test.ts`, and `board-match-*.test.ts` enforce horizontal overflow, sticky/fixed
   shell chrome, 44px mobile touch targets, hover/focus styling, WCAG AA `axe` cleanliness, and
   seeded screen content across 390px and 1280px light/dark viewports.
2. **Visual regression suites keep all seeded content and accessibility checks** without asserting
   pixel-for-pixel equality or pre-Ember JSON box dimensions against the retired `design/reference/`
   PNGs.
