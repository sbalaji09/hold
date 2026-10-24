# Callback

UI work follows the Callback design system in `design/callback/`. Use the `callback-design` skill (`.claude/skills/callback-design/SKILL.md`) before building or changing any screen, component, style or copy. Start with `design/callback/README.md`.

- Styles come from `design/callback/tokens.css` (plus `tailwind-theme.css` with Tailwind v4). Never hard-code colours, fonts, radii or shadows.
- Reuse the system's components (props in `design/callback/components/index.d.ts`) before writing new ones.
