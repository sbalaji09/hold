---
name: callback-design
description: Callback's design system (the security-printed ledger). Use for ANY UI work in this repo — building or changing a screen, component, style, copy, empty or error state — so it matches Callback's tokens, components and voice.
---

# Callback design system

The source of truth lives in `design/callback/`. Read it before writing UI. Don't work from memory.

## Read first, in this order
1. `design/callback/README.md`: the brand book. Principles, colour meanings, type roles, voice, layout.
2. `design/callback/tokens.json`: every token, with a `usage` note saying where it goes.
3. `design/callback/components/<Name>/README.md` for each component you touch, plus `components/index.d.ts` for its props.
4. For a whole screen, open `design/callback/reference/bill-page.html` and `reference/prototype-app.js` to see how the parts compose.

## How to apply it
- **Styles.** Import `design/callback/tokens.css` once (app root or `globals.css`). It defines every token as a CSS variable, both themes, and the Google Fonts import. With Tailwind v4, also import `design/callback/tailwind-theme.css`. That gives you `bg-surface`, `text-ink`, `text-hold`, `border-line`, `font-serif`, `rounded-md`, `shadow-doc` and so on.
- **Never hard-code a colour, font, radius or shadow.** Use `var(--token)` or the Tailwind class mapped to it. If a value you need doesn't exist, stop and ask before inventing one.
- **Components.** `components/bundle.js` and `bundle.css` are the reference implementation (UMD, `window.Callback`, React 18). In a React/Next.js codebase, port each component to a typed TSX file under `components/callback/`. Keep the same props as `index.d.ts`, the same class names and structure as in `bundle.js`, and the same CSS. Don't restyle them. `Guilloche` is generated from code: copy its `rosettePaths` maths exactly.
- **Use the existing component before making a new one.** Statuses are `StatusMark` (exactly six), money is `Amount`, bank accounts are `AccountLine`, sources are `Cite`, agent checks are `CheckRow`, calls are `Line` plus `TranscriptLine`, approvals are `SignOff`, decisions on a document are `Endorsement`, history is `LogEntry`, lists are the ledger (`InboxRow`).

## Rules to check before you finish
- Colour only for attention. `hold` means money stopped, `brass` means a line is open, `signatory` means a person, `graphite` means still checking. Paid and Scheduled stay grey. The primary button is ink.
- Callback's own words are in mono (`--font-mono`). People's names and quoted words are in `signatory` italic serif. Screen titles are the serif `display` style. Uppercase only through the `caps` style.
- Every claim Callback makes carries a `Cite`. Locked actions use `Button locked="reason"` and are never hidden. The unhappy paths (no answer, dropped call) are written states with retry times.
- Copy: plain, specific, past tense. Use `$18,400.00` and `··2210` formats. No "fraud score", "AI-powered", emoji or exclamation marks. Status words are exactly Paid, Scheduled, Checking, Calling, Held, Needs you.
- Both themes (Paper and Vault) must work. Text holds 4.5:1 contrast. Focus is a 2px ink outline. Respect `prefers-reduced-motion`.
- No landing page, no stats tiles, no charts. The app opens into the Inbox.
