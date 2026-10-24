# Phase 1: project scaffold, Convex schema, Fogline data

> Naming: the product is now called **hold** (the brief still says "Callback"). Use "hold" in code, package name and UI wordmark. The design system folder `design/callback/` keeps its name.

Goal: the contract voice depends on (Convex schema) and Fogline's seed data with planted scams. Source: `product-brief.md`, `plan-agent.md` scope items 1 and shared interface contract.

## Tasks

1. **Scaffold** (`package.json`, `tsconfig.json`, `convex/`): TypeScript, Convex, Next.js app dir. Package name `hold`. No UI yet. Node 22.
2. **Schema** (`convex/schema.ts`): tables `suppliers`, `bankAccounts` (history, `verifiedBy`), `bills` (status: Paid|Scheduled|Checking|Calling|Held|Needs you), `emails`, `payments` (`transferId` optional), `callRequests`, `callEvents`, `callResults`, `inboundCalls`, `approvals`, `activity` (actor: callback|maya|dev, what, why, ref). Shapes of call tables follow the interface contract in `plan-agent.md` exactly.
3. **Data** (`data/`): generator `data/generate.ts` (seeded RNG, deterministic) writes `data/fogline.json`: 25 suppliers, ~6 months of mostly boring bills, emails, payments, past calls. Hero supplier Stagecraft Rigging Co. (stage builder), Sept invoice #4471, contact Rosa Quintero, Chase ··2210. Also `data/planted-scams.md`: list of every planted scam with bill id and which checks should fire.
4. **Seed** (`convex/seed.ts`): mutation loading `data/fogline.json`.

## Review (haiku, lightweight)
Check against brief: 25 suppliers, 6 months, hero supplier, planted list, statuses exact, "hold" naming.
