# Phase 4: Apify checks, learned rules, escalation routing, Practice regression (hold)

Source: `plan-agent.md` Next tier + Hyphenate addendum. Additive to phases 1-3.

- Schema: `learnedRules`, `backgroundChecks`, `suppliers.status`, `approvals.routedTo/reason`.
- Apify: `actor/` (hold-supplier-verifier), `convex/app/background.ts` (Apify REST, local fallback), supplier + bill panels. Suggested number is shown only; trusting it stays locked for Dev.
- Learning: `convex/app/rules.ts`, rule-aware `checks.ts`; rules never bypass `lib/policy.ts` or a literal bank-change request.
- Routing: `routeEscalation` -> Approvals, bill page. Suppliers overview with New/Trusted/Under review. New supplier + bank change or >= $5,000 always calls; first confirmed live call marks it Trusted (`writeResult`).
- Practice: Add to practice set, Generate new set (dedupe), checks fired vs expected, legit-mess data that must not be held.
- Build: `next.config.mjs` extensionAlias so pages can import `convex/app/checks.ts`.

Not verified: any real Convex, Apify, Claude or Twilio run.
