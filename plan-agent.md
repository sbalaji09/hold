# Callback: App plan (agent, app and data)

**Owner:** App person. **Teammate:** Voice person (see `plan-voice.md`).
Updated to match the latest product brief. The brief calls this half "App." You own the agent's decisions, every screen except Live call and Phone line, the data and the money. You meet voice at the **bill page**: you send call requests and show the call's result.

## Your scope

1. **Convex schema and Fogline's data. Do this first; voice's Moss index depends on it.**
   - 25 suppliers: stage builder, sound rental, security, artist agencies, food vendors. Each has a trusted phone number, domain, bank details with history, and contacts.
   - Six months of **mostly boring** bills, emails, payments and past calls.
   - A written list of every planted scam.
   - **The hero supplier is the stage builder.** Its September invoice #4471 is the record Callback asks about. The demo scam comes from the stage builder's **real address** (a hacked account), so the domain check *passes*, but the new bank account and the writing style *fail*.
2. **Real bills inbox.** A real email address that anyone can email, judges included, feeding into Convex. An inbound-email webhook or a polled mailbox both work. Parse supplier, amount, invoice #, and bank details.
3. **Checks (step 2).** Each check produces evidence in plain words:
   - "Bank account never used before"
   - Look-alike domain: "domain registered 4 days ago"
   - Copied website (with Apify, see Together)
   - Rush language
   - Unusual amount
   - Shared scam blocklist (bonus only)
   - Writing style: call voice's `styleMatch` for "writing doesn't match this supplier's last 14 emails"
4. **Decision and limits (step 3), enforced on the server, not just in the UI.**
   - Safe and under $10k: pay. Safe but over $10k: Dev. Risky: write a `call_request`.
   - Callback can't approve its own payments, change bank details alone, or release a held payment.
   - Every blocked action returns a reason, and the UI shows it on a greyed-out button.
   - Never pay on a guess: `handed_off` means **Needs you** for Maya.
5. **Screens.** Look like Gmail, Linear or Ramp: tables, plain type, neutral colours, colour only for status.
   - **Inbox (home):** every incoming bill and supplier email, newest first, each with a status: Paid, Scheduled, Checking, Calling, Held, Needs you. Filter by status. The link opens straight here, logged in. No landing page.
   - **Bill page:**
     - Left side: the original email and invoice.
     - Right side: Callback's checks with evidence, the call result and recording, and a timeline.
     - Actions: Pay, Hold, Call supplier, and "Why?" in plain words.
   - **Approvals (Dev's screen):** big payments, held payments and bank changes, each with Callback's recommendation and evidence. Approve, reject or reply. **Pushback:** when Dev writes "Release it, we'll miss the stage build," Claude answers with the call clip and evidence, then offers a safe alternative: pay the old, verified account.
   - **Payments:** this week's payment run, through the **Increase sandbox**, with each transfer ID shown.
   - **Suppliers:** a list, plus a page per supplier with its trusted number and when it was last checked, bank-detail history with how each change was verified, past bills, past calls, and background-check results.
   - **Activity log:** every action by Callback, Maya and Dev, with who, when, what and why. Search, filter, and open the item it touched.
   - **Practice:** see Together.
6. **Two logins.** Maya and Dev, so a second laptop can sit on Dev's view for judges.
7. **Measurable, inside the app.** Real counts, never on a slide: scams caught vs missed on the Practice set, real bank changes wrongly held, minutes per check call. Optionally a "watch only" setting (flag and call, never move money) to show the path to production.

**Together with the voice person (you lead both):**
- **Practice:**
  - A set of fake scam emails written by Claude, run against a *copy* of the workspace, with whether each was caught last time.
  - **Try a scam** lets a judge write one, and it lands in the real inbox.
  - Voice supplies a simulated supplier so practice runs don't dial real phones.
- **Apify supplier verifier:**
  - Background check on new suppliers (website, business registry, Google Maps listing, domain age), which is where a trusted number comes from.
  - Copycat check: scrape an unfamiliar domain's site against the real supplier's.
  - Publish both as one Actor for Best Actor.

## Your timeline

Check-in is 1:30 PM Friday and opening is 4 PM. Tables are assigned after 9 AM Sunday, and closing ends by 4 PM Sunday. Confirm the submission deadline on the live site.

| When | You | Sync point |
|---|---|---|
| Friday, before check-in | Convex project, Increase sandbox and Claude keys. Decide how the inbox receives email | |
| Fri, first 2 hrs of hacking | Lock the contract with voice. Convex schema. **Generate and commit Fogline's data and the planted-scam list** | Contract + data done (voice needs it for Moss) |
| Fri night | Real email → Inbox → checks with evidence → decision. Server-side limits | |
| Sat morning | Bill page and `call_request` writing. Show live call status and results on the bill | **Sat ~noon: first end-to-end.** Real email → bill page → real call → Held |
| Sat afternoon | Approvals with pushback, Payments on Increase, Activity log, Dev login | |
| Sat evening | Everything on the "must work" list solid. Full 2-minute run | **Full demo run.** Record the backup video Saturday night |
| Sat night | Next tier: Suppliers page, Practice and Try a scam, Apify Actor | |
| Sun before 9 AM | Freeze. Rehearse 3×. Print the card with Fogline's phone number and bills email | **Freeze** |

## Your risks

- **The policy only lives in the UI.** A judge will ask "what stops the agent from just paying it?" Show the server refusing.
- **Data that looks fake.** The inbox is the first thing judges see. Spend real time on boring, realistic bills and emails.
- **A hardcoded number sneaks in.** Every count must be clickable through to the records behind it.
- **Email delivery delay** during the 0:10–0:25 beat. Test end-to-end latency from a phone's mail app, and have the scam email drafted and ready to send.

---

## Shared section (identical in both plans; change it only together)

### What Callback is

Scammers email companies pretending to be a supplier: "we switched banks, pay us here now." Callback is the app a finance team uses to pay its bills.

- It pays normal bills on its own.
- When a bill or a bank change looks off, it phones the real supplier on the number already on file, asks questions built from that supplier's real history, and holds the money if the answers don't check out.
- It also answers the company's own phone line. It never changes bank details from an incoming call; it says "we'll call you back on the number we have."

Demo company: **Fogline**, a made-up 3-day SF music festival, two weeks before gates open, with about 25 suppliers and 6 months of bills. Users: **Maya** (bookkeeper) and **Dev** (controller, approves payments over $10k).

**Callback does one job: stopping payment scams.**

### Who owns what

| | Owns |
|---|---|
| **Voice** | Outgoing check calls, incoming phone line, Live call screen, building questions from Moss lookups, turning a call into confirmed / not confirmed |
| **App** | Inbox, bill page and its checks, Approvals with "why?", Payments through the test bank (Increase sandbox), Activity log, Fogline's data |
| **Together** | Practice, supplier background check (Apify) |

The two halves meet at the **bill page**: the app opens a call request from it, and the call's result lands back on it.

### How a bill moves (five steps)

1. **A bill arrives** at Fogline's real bills email address. Anyone can email it, judges included.
2. **Callback checks it** for:
   - a bank account it hasn't seen
   - a look-alike domain or copied website
   - rush language
   - an unusual amount
   - an account on the shared scam blocklist
   - writing that doesn't match the supplier's past emails (Moss)
3. **It decides.**
   - Safe and under $10k: pay.
   - Safe but over $10k: ask Dev.
   - Risky: call the supplier.
4. **It calls** the number on file and asks questions built from the supplier's real history. The answers decide whether the bill is paid or held.
5. **It records everything** in the Activity log and on the bill page.

Bill statuses: `Paid · Scheduled · Checking · Calling · Held · Needs you`.

### Stack (from the brief)

| Piece | Job |
|---|---|
| **Convex** | Everything: data, live updates to Maya's and Dev's screens |
| **Cartesia** | The voice on every call, outgoing and incoming. Core of the product, not an add-on |
| **Moss** | Instant search over each supplier's past emails, bills and calls. Picks call questions live; compares writing style in step 2 |
| **Apify** | (1) Background check on new suppliers: website, business registry, Google Maps listing, domain age. This is where a trusted phone number comes from. (2) Copycat check: scrape an unfamiliar domain's site against the real supplier's and flag copies ("copied from the real one, registered 4 days ago"). Publish both as one "supplier verifier" Actor for the Best Actor prize |
| **Claude** | Reads bills, writes call questions, judges answers, writes Practice scams |
| **Increase sandbox** | Test bank; every payment shows a transfer ID |

**Targets:** Hyphenate ($8k / $5k / $3k), Microsoft Built for the Real World, Cartesia, Moss, Apify. Convex comes along for free. Anthropic if their prize fits. Factory only if the Droid SDK runs the bill-check agent without a rewrite (check at their workshop). **Skipping:** Creao, CRS, SpaceXAI, Visa.

### Interface contract

All of these are Convex tables or functions.

**1. Call request (app → voice).** Written when step 3 says "risky," or when Maya clicks Call on a bill page.
```json
{
  "call_id": "call_123",
  "bill_id": "bill_4471",
  "supplier_id": "sup_stage",
  "to_number": "+1XXXXXXXXXX",
  "number_source": "on_file" | "background_check",
  "reason": ["new bank account", "writing style doesn't match last 14 emails"],
  "status": "queued"
}
```
`to_number` is never a number taken from the email. Voice builds the questions itself from Moss.

**2. Live call events (voice → Convex).** The Live call screen and bill page subscribe to these.
```json
{ "call_id": "call_123", "type": "status",   "value": "ringing" | "in_progress" | "no_answer" | "retry_scheduled" | "ended",
  "retry_at": "2:15 PM" }
{ "call_id": "call_123", "type": "segment",  "speaker": "callback" | "supplier", "text": "...", "ts": 0 }
{ "call_id": "call_123", "type": "question", "ask": "Can you confirm the total on your September invoice?",
  "source": { "kind": "invoice", "ref": "#4471" } }
```

**3. Call result (voice → app).**
```json
{
  "call_id": "call_123",
  "outcome": "confirmed" | "not_confirmed" | "handed_off",
  "evidence": [
    { "ask": "...", "source": { "kind": "invoice", "ref": "#4471" }, "answer": "...", "matches": true },
    { "ask": "Did you recently change your bank account?", "answer": "No, we never changed our bank.", "matches": false }
  ],
  "summary": "Supplier says they never changed bank details.",
  "recording_url": "...",
  "clip": { "start_s": 41, "end_s": 47 }
}
```
- `handed_off`: no answer after a retry, or the call dropped. The app shows **Needs you** for Maya.
- The app never pays on a guess.
- The `clip` is what Callback quotes back to Dev on pushback.

**4. Writing-style check (voice provides, app calls).**
`styleMatch(supplier_id, email_text) → { matches: bool, score, compared_with: 14 }`, built on the same Moss index.

**5. Incoming call (voice → app).** Voice writes an `inbound_call` record (caller number, who they claim to be, what they asked for, transcript). If they asked to change bank details, voice also writes a call request to the supplier's number on file. The app shows it in the Inbox and Activity log. Nothing is ever changed from an incoming call.

### Demo (2 minutes, demo first)

No slides, no title screen, no stats page. Numbers are said out loud, never put on a screen. Tables are shared by 2–3 teams and assigned after 9 AM Sunday, so it will be loud: make the live transcript large and hold the ringing phone close to the judge on speaker.

| Time | What we do | What the judge sees |
|---|---|---|
| Before | App open on Fogline's Inbox, logged in as Maya | A real-looking inbox, most bills Paid or Scheduled |
| 0:00–0:10 | Hook, while the inbox is on screen | The product, not a slide |
| 0:10–0:25 | A teammate sends the scam email live from the stage builder's real address. Open the bill page | It pops in as Checking, then Calling. Domain check passes; new bank account and writing style fail, each with evidence |
| 0:25–1:15 | Live call screen opens on its own | Teammate's phone rings. Callback says it's an automated assistant, asks about September's invoice #4471 and shows where that came from. "We never changed our bank." Status: **Held** |
| 1:15–1:45 | Switch to Dev's Approvals. Dev types "Release it, we'll miss the stage build." | Callback replies with the call clip and evidence and offers to pay the old, verified account. Dev approves; Payments shows the transfer in the test bank |
| 1:45–2:00 | Open the Activity log while closing | Every step, with who, when and why |
| Questions | Hand the judge a card with Fogline's phone number and bills email | They call as a "supplier" asking to change bank details; Callback says it will call back on the number on file. Or they click **Try a scam**, or we run Practice |

**What to say**
- **Hook:** "Last year US businesses lost about $3 billion to fake supplier emails, across nearly 25,000 complaints to the FBI, and losses are still rising. Every fraud guide gives the same fix: call the supplier on a number you already have. Callback makes that call."
- **Close:** "Callback fills the bills-payment and supplier-records seats at Fogline. It answers to the controller and can't approve its own payments."
- **If asked "what's next?":** the same scam runs in reverse. Criminals pose as a company to its suppliers to place fake orders, and the same check-call agent can protect those suppliers too.
- **If a judge has more time:** run Practice to show the catch rate, and open a supplier's page to show its bank-change history.

**Demo video (Hyphenate requires it):** open on the phone ringing and "we never changed our bank," then show the same flow.

**Backup:** record a clean run Saturday night. If the venue phone line or Wi-Fi fails, say so and play it. Never fake a live call.

### Build rules: real software, not a stats website

The test for every screen: if a real bookkeeper sat down at it Monday morning, could they do their job without us explaining it?

1. **No landing page.** The link opens straight into Fogline's Inbox, logged in. No hero, no marketing copy, no "How it works."
2. **No hardcoded numbers.** Every number is counted from workspace data. If you can't click it and open what's behind it, it doesn't belong.
3. **Every screen has a next action.** No "insights" or "impact" pages.
4. **Real triggers only.** Real email to a real inbox, real phone call, real test-bank transfer. No hidden "run demo" button.
5. **Mostly boring data.** Six months of normal bills; mostly dull, with one problem in it.
6. **Show the agent's work where it happens:** on the bill page and the Live call screen, not in a separate scrolling "AI console."
7. **Look like a work tool.** Think Gmail, Linear or Ramp: tables, plain type, neutral colours, colour only for status.
8. **Handle the unhappy paths.** "No answer, trying again at 2:15 PM." Call dropped? Say so.
9. **Let judges use it.** A second laptop logged in as Dev. Phone number and bills email on a printed card.

### Responsible design (Microsoft, Cartesia and Hyphenate all score this)

- **Every call:**
  - Opens with "Hi, this is an automated assistant calling for Fogline's accounts team" and says the call is recorded.
  - Only calls numbers on file or found by the background check.
  - Stops and listens if interrupted.
  - On no answer, retries once, then hands off to Maya.
- **Limits:**
  - Callback can't approve its own payments, can't change bank details alone, and can't release a held payment.
  - Recordings and transcripts stay on their bill, visible only to Fogline's team.
  - No real people's data: Fogline is made up, and the background check reads only public business pages.
- **Path to a real product:**
  - Plugs into a shared bills inbox, QuickBooks or NetSuite, and the company's bank.
  - Starts in "watch only" mode, flagging and calling without moving money.
  - Measurable: scams caught vs missed on the Practice set, real bank changes wrongly held, and minutes per check call vs doing it by hand. These show as real counts in the app, never on a slide.
- **README (Cartesia requires it):** setup, which Cartesia features we used, known limitations. No API keys in the repo.

### Priorities

| Priority | Features |
|---|---|
| **Must work by Saturday night** | Fogline's data with planted scams, Inbox, bill page, outgoing call (with AI disclosure and no-answer handling), Approvals with pushback, Payments, Activity log, all on Convex |
| **Next** | Phone line (judge calls in), Practice with Claude's fake scams, Apify background check and copycat check (Suppliers page and bill page), published as an Actor |
| **Bonus, never in the main demo** | Shared scam blocklist across companies, cloned-voice check |

**Real:** phone calls both directions, emails into the bills inbox, Callback's checks and decisions, test-bank transfers, background checks on real public websites.
**Simulated:** Fogline and its people, six months of past bills and emails (generated, with a list of every planted scam), the supplier who answers the call (a teammate), the money.

**Not building:** landing page, charts or an analytics dashboard, Visa payments, a mobile app, a QuickBooks connection, general bookkeeping checks like double bills, the reverse scam, or Creao, CRS or SpaceXAI integrations.

---

## Addendum: Hyphenate feedback (shared, identical in both plans; change only together)

Added after talking to Hyphenate. Everything above still stands; this only adds. The brief wins in any conflict.

### What Hyphenate told us
- Adapt to new fraud techniques, not only the ones we planted.
- The agentic loop should work for more than fraud.
- Focus on real-world application; the music festival is interesting, so keep Fogline realistic.
- Self-improvement and a human in the loop.
- Adapt to new suppliers.
- A view of all suppliers involved with the company.

### Their four judging questions, and our answer
| Question | Our answer |
|---|---|
| **Real.** Real-enough data with the mess left in, and an answer key | Fogline's bills carry normal mess (odd formats, a missing field, a legit bank change that must NOT be held). The planted-scam list is the answer key. |
| **Hireable.** One role, drafts it, asks the right person, every action traces to a record | One role: bills payment and supplier records. It escalates to a named person (Maya or Dev) and every claim carries a `Cite`. |
| **New.** Something new | A check call to the number on file, built from the supplier's own history, instead of another invoice bot. |
| **Wow.** One moment | The phone rings on the table and the payment is held. |

### The loop (Hyphenate's pattern, applied to hold)
**Learns** from six months of history, **Runs** on its own, **Escalates** to a named person with a stated reason and holds only that item, then **Improves**: the human's answer is saved as a policy and never asked again.

hold's version: it learns each supplier's normal (banks, amounts, writing, who answers), runs routine bills on its own, escalates a risky bill to Maya or Dev with the reason in words, and saves the outcome as a **learned rule** on that supplier, cited the next time it applies.

The loop is the platform; payment scams are its first role. Pitch line only: "the same loop (learn, run, escalate, improve) fits other finance roles." We do **not** build other roles, bookkeeping checks or the reverse scam.

### Additive features
1. **Learned rules (self-improvement).** When Maya or Dev resolves an escalation, hold may save a rule on that supplier (e.g. "Stagecraft: bank changes need a passed call plus Dev; verified account Chase ··2210"). Rules show on the supplier page and are cited on later bills. A bill that matches a saved rule is not escalated again for that reason. Rules never relax the hard limits: no self-approval, no bank change alone, no releasing a held payment alone.
2. **New fraud techniques.** The Practice set is a regression suite. A scam hold missed, or one a person reports, is added to the set. "Generate new set" asks Claude for fresh variants (new pretexts, new phone tactics). Shown as caught or missed per scam, never as a score.
3. **New suppliers.** A new supplier starts as `New`: background check first (Apify), trusted number from it, and its first bank change or large bill always gets a call. It becomes `Trusted` after its first confirmed call. With little history, check-call questions come from what Fogline itself holds (orders, contract terms, invoice records), never from the email.
4. **Escalation reason, no score.** Every `Needs you` or approval shows who it is routed to and why in words ("sources disagree", "no precedent for this supplier"). No percentage confidence or risk score is shown (design rule: show the words, not a score).
5. **Suppliers overview.** The Suppliers list shows every supplier with status (New, Trusted, Under review), trusted number last checked, open items, and a link to each. Counts are clickable to the records.

### Contract addition (optional field, existing consumers unaffected)
Call result and `handed_off` may carry `escalation: { to: "maya" | "dev", reason: "..." }`. Absent means the app derives it.

### Demo addition (only if a judge has more time; main 2-minute run unchanged)
Resolve an escalation, then show the learned rule on the supplier page and send the same case again: it no longer asks. Real-world line for the Q&A: "Fogline is the test bed; the same finance team shape exists at any business paying many vendors."

---

## Addendum: App person (Hyphenate feedback)

Additive to the scope above. Priority tags follow the brief: do **Must** items first, these are **Next** unless noted.

1. **Learned rules** (Next, but cheap). New Convex table `learnedRules` (supplier_id, text, created_by, source bill/approval, created_at). On Dev's approve/reject or Maya's resolve, offer "Save as a rule for this supplier". Rules appear on the supplier page and as a `Cite` on later bills. Checks consult rules to skip a repeat escalation. Server-side limits stay unchanged and can never be relaxed by a rule.
2. **Escalation reason and routing.** Store `routedTo` (maya|dev) and a plain-words `reason` on Needs you / approvals. Show in the bill page, Approvals and Inbox row. No score.
3. **Suppliers overview.** Extend the Suppliers list: status New/Trusted/Under review, last checked, open items (clickable). `New` until the first confirmed call; first bank change or large bill from a `New` supplier always writes a `call_request`.
4. **Practice as regression suite.** "Add to practice set" on any missed or reported bill; "Generate new set" prompts Claude for new pretexts. Per-scam caught/missed only, no score.
5. **Data realism (answer key).** Add normal mess to Fogline data and keep `data/planted-scams.md` as the answer key: a few odd invoice formats, one missing field, and at least one legit bank change that must not be held.
6. **Pitch.** Keep the main run unchanged. Add the optional learned-rule moment to the "more time" list.
7. **Not doing:** other finance roles, a confidence percentage, or a general bookkeeping agent.
