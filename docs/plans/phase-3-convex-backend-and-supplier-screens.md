# Phase 3: Convex backend, intake, payments, Suppliers, Practice (hold)

Source: `product-brief.md`, `plan-agent.md` items 2-4, 7 and Together. Nothing is deployed yet (no Convex project, Increase key, Anthropic key, email provider). Everything must typecheck and have convex-test coverage where logic matters; env vars are read lazily and missing keys fail with a clear error, never a fake success.

## Wave A (parallel, disjoint files)
- **A. Server-side limits + workflow** (`convex/app/queries.ts`, `convex/app/mutations.ts`, `convex/app/pushback.ts`, `convex/app/mutations.test.ts`): queries the screens need, mutations payBill/holdBill/requestCall/decideApproval/runPayments that enforce `lib/policy.ts` on the server (refuse with the reason), write `activity` rows, and write `callRequests` per the shared contract (`to_number` only from the supplier's trusted phone). `pushback` action: Claude replies to Dev with call evidence and the old verified account.
- **B. Intake + checks + Increase** (`convex/app/checks.ts`, `convex/app/intake.ts`, `convex/app/increase.ts`, `convex/http.ts`): inbound-email webhook parses supplier/amount/invoice/bank, creates email+bill (Checking), runs checks (new bank, look-alike domain, rush, unusual amount, `styleMatch` from voice), decides (pay / ask Dev / write call request). Increase sandbox transfer action returns a transfer ID.
- **C. Suppliers + Practice** (`app/suppliers/**`, `app/practice/**`, `convex/app/practice.ts`, `components/TrySamScam`-style client bits): supplier list and page (trusted phone and last checked, bank-change history with how verified, bills, calls), add-supplier form (background check hook is Apify, next phase), Practice screen with fake-scam set written by Claude, run against a workspace copy, caught/missed per scam, Try a scam lands in the real inbox via the intake path.

## Wave B (serial after A)
- Rewire `lib/data.ts` to Convex (`convex/nextjs fetchQuery`, JSON fallback when `NEXT_PUBLIC_CONVEX_URL` is unset) and wire Pay/Hold/Call/Approve/Reject/Reply/Run payments buttons to the mutations.

## Review
Reviewer pass vs brief, plan-agent and design rules; fix-ups; `pnpm typecheck`, `pnpm build`, `pnpm test`.
