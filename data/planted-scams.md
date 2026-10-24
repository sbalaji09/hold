# Fogline: planted scams

Every problem in `data/fogline.json`, plus the live demo scam (not in the seed).
Ratio: 5 planted scams + 2 legit-but-flaggable bank changes across 147 bills —
roughly one problem per ~20-ish bills, the inbox is otherwise dull Paid/Scheduled.

## Live demo scam (NOT in the seed — arrives live, during the demo)

A teammate sends this email live, from Rosa's **real** address, right before the
"Live call" beat of the pitch.

- **From:** `rosa@stagecraftrigging.com` (real address — implies her account was
  compromised, not a look-alike domain)
- **Bank:** Mercury, account ending **8817** (brand-new, never seen before —
  Stagecraft has only ever used Chase ··2210)
- **References:** September invoice #4471 ($18,400.00, main-stage truss), the
  same invoice already confirmed and Paid in the seed — the scam email reuses
  a real invoice number to look legitimate.
- **Checks that should fire:** new bank account, rush language, writing style
  doesn't match Stagecraft's last 14 emails (voice is noticeably off from
  Rosa's usual formal tone)

**Email text to send:**

> Subject: Updated bank details — please action today
>
> Hi team,
>
> We've had to switch banks urgently this week due to an issue with our old
> account. Can you please redirect payment for invoice #4471 ($18,400.00) to
> our new account below? We need this today — our vendor payments are blocked
> until this clears.
>
> New account: Mercury, account ending 8817.
>
> Thanks for the quick turnaround,
> Rosa Quintero
> Stagecraft Rigging Co.

Expected flow: Checking → Calling (Callback phones the trusted number on
file, **not** any number in the email) → supplier says "we never changed our
bank" → **Held**.

## Seeded scams (in `fogline.json`, `plantedScams` array)

| key | bill | supplier | kind | checks that should fire | status |
|---|---|---|---|---|---|
| `scam_ggtruss_lookalike` | `bill_4140` (invoice #4140) | Golden Gate Truss & Deck | look-alike domain (`gg-trussdeck.com` vs real `ggtrussdeck.com`) + new Mercury account + same-day rush language | look-alike domain, new bank account, rush language | Held |
| `scam_fogcity_newbank` | `bill_4141` (invoice #4141) | Fog City Ramen | new Mercury account (··8832) from the supplier's real address, never seen before | new bank account, no prior history with this account | Needs you (call went unanswered twice) |
| `scam_guardiangate_amount` | `bill_4142` (invoice #4142) | Guardian Gate Security | invoice ~8x their normal size ($47,000 vs usual $900–$6,200) + same-day urgency | unusual amount, rush language | Held (supplier couldn't confirm by phone) |
| `scam_cascade_rush` | `bill_4143` (invoice #4143) | Cascade Talent Group | "artist will pull out" rush language + new First Republic account ··7743 | rush language, new bank account | Held |
| `scam_bayfront_lookalike` | `bill_4144` (invoice #4144) | Bayfront Waste & Recycling | look-alike domain (`bayfront-waste.co` vs real `bayfrontwaste.com`) + new Mercury account ··9014 | look-alike domain, new bank account | Needs you (call confirmed it wasn't theirs) |

Exact bill keys, invoice numbers and full email/call text live in
`data/fogline.json` — search for `"planted": true` in `bills`, or the
`plantedScams` array for the structured version.

## Legit bank changes (false-positive guard — "wrongly held" measurement)

These two are **not** scams. They're real bank changes that would otherwise
trip the "new bank account" check, so the demo can show Callback verifying and
releasing them instead of just blocking — this is what "real bank changes
wrongly held" measures against.

| supplier | reason | new bank | verified by | outcome |
|---|---|---|---|---|
| Perimeter Pro Staffing | acquired by a regional security group | US Bank ··5509 | call + Dev | confirmed by phone, Dev approved, bill Paid |
| Horizon Artist Management | switched operating bank this quarter | Bank of America ··6621 | call + Dev | confirmed by phone, Dev approved, bill Paid |

Both suppliers' `bankAccounts` rows show the old account `retired` and the new
one `active` with `verifiedBy: "call+dev"`; both bills ended up `Paid` to the
new account, with a `confirmed` call on record.

## Legitimate mess (must NOT be held)

Ordinary noisy invoicing — odd invoice-number formats, a body copy that drops
the invoice number, casual supplier phrasing — plus a third dev+call-verified
bank change. None of these should trip `runChecks`; they're regression
fixtures for "legitimate mess Callback must not hold."

### Odd invoice-number formats (6)

| bill | supplier | invoice no. as written |
|---|---|---|
| `bill_4005` | Bayview Staging Systems | `FGL4005` |
| `bill_4019` | Soundwave Audio Rentals | `4019-REV` |
| `bill_4036` | SF Bay Security Services | `No. 4036` |
| `bill_4059` | Cascade Talent Group | `4059.1` |
| `bill_4083` | Bay Bites Food Co. | `No. 4083` |
| `bill_4110` | Sunset BBQ Co. | `4110.1` |

### Invoice number missing from the email body (2)

Subject line has `Invoice #____`, but the body never repeats the number (just
says "attached is our invoice").

| bill | supplier |
|---|---|
| `bill_4025` | Pacific Coast PA Co. |
| `bill_4097` | Embarcadero Eats |

### Casual supplier phrasing (3)

Lower-case "hey!" openers, "lemme know if anything looks off!" — a normal
small-business tone, not a scam signal.

| bill | supplier |
|---|---|
| `bill_4013` | Soundwave Audio Rentals |
| `bill_4064` | Night Owl Artist Agency |
| `bill_4116` | Bayfront Waste & Recycling |

### Third verified bank change

| supplier | reason | new bank | verified by | outcome |
|---|---|---|---|---|
| SF Fence & Barricade Co. | switched to a business bank account | Silicon Valley Bank ··3384 | call + Dev | confirmed by phone, Dev approved, bill Paid (`bill_4147`) |

Same shape as the two above: old account `retired`, new one `active` with
`verifiedBy: "call+dev"`, bill `Paid` to the new account with a `confirmed`
call on record (`call_sffence_verify`).

