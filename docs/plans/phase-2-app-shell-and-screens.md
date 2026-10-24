# Phase 2: app shell and must-work screens (hold)

Source: `product-brief.md` screens table, `plan-agent.md` item 5, `design/callback/` via the `callback-design` skill. App is named **hold**.

No Convex deployment exists yet, so screens read `data/fogline.json` through one module, `lib/data.ts` (async functions: `listBills`, `getBill`, `listApprovals`, `listPayments`, `listActivity`, ...). Swapping to Convex queries later touches only that file. All counts are computed from the data (no hardcoded numbers).

## Wave A (foundation, serial)
- Next.js app dir, Tailwind v4 with `design/callback/tokens.css` + `tailwind-theme.css`.
- Port every component in `design/callback/components/` to typed TSX in `components/callback/` (props from `index.d.ts`, same classes/CSS).
- `app/layout.tsx`: sidebar (Inbox, Approvals with count, Payments, Suppliers, Phone line, Practice, Activity log), wordmark "hold", signed in as Maya, theme.
- `lib/data.ts` + `lib/policy.ts` (server-side rules: under $10k pay, over $10k ask Dev, cannot self-approve, cannot release held, each returns a reason string).

## Wave B (parallel screens, disjoint files)
- B1: Inbox (`app/page.tsx`, status filter) and Bill page (`app/bills/[key]/page.tsx`): checks with evidence, timeline, locked buttons with reasons, "Why?".
- B2: Approvals (`app/approvals/page.tsx`) with pushback thread and Payments (`app/payments/page.tsx`) with transfer IDs.
- B3: Activity log (`app/activity/page.tsx`) with search/filter.

## Review
Lightweight reviewer pass against brief and design rules.
