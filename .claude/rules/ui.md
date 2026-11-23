# UI rules

The order of authority for anything a person sees:

1. `docs/SPEC.md` — product: words, screens, behaviour. The spec wins on what the product is.
2. `DESIGN.md` — look: Ember's palette, the nine typography tokens, components, states, motion. DESIGN.md wins on
   how it looks.
3. Installed skills — engineering and UX guardrails (accessibility, composition, motion, React). They inform the
   work; they never override a token, a colour or an identity rule from DESIGN.md.

If a guardrail and DESIGN.md disagree about look, follow DESIGN.md and note the conflict on the issue. If
DESIGN.md and `docs/SPEC.md` disagree about product, follow the spec. A rule that is wrong is changed in the ADR,
not worked around in a component.

## Typography and tokens

- Every text element uses one of the nine tokens: `text-hero`, `text-section`, `text-page-title`, `text-card-title`,
  `text-metric`, `text-base`, `text-sm`, `text-xs`, `text-eyebrow`.
- `text-page-title` is the app page-title token (`dsPageTitle`); `text-section` is only for landing/marketing.
- `overture/no-raw-design-styles` covers all of `src/web` and rejects `text-[…px]`, `text-[…rem]`,
  `text-lg`…`text-9xl`, off-scale spacing, inline design styles and raw colours.

## Installed skills

The project skills live in `.claude/skills` (Claude Code) and `.agents/skills` (OpenCode), installed project-scoped
with `npx skills add` and recorded in `skills-lock.json`. To reinstall or add one:

```sh
npx skills add <owner>/<repo> -s <skill> -a claude-code -a opencode -y --copy
```

Both agents are passed with repeated `-a` flags; comma-separated agent lists are rejected by the CLI.
