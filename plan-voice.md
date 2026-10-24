# Callback: Voice plan

**Owner:** Voice person. **Teammate:** App person (see `plan-agent.md`).
Updated to match the latest product brief. Your half covers everything that happens on a phone call. You meet the app at the **bill page**: it sends you call requests, and your call results land back on it.

## Your scope

1. **Telephony.**
   - Set up one real number for Fogline's line, plus outbound calling.
   - **Upgrade off any trial account before check-in today.** Trial accounts usually play a notice at the start of each call and can only call pre-verified numbers, which breaks the "judge calls from their own phone" moment.
   - The "supplier" phone is your teammate's phone.
2. **Real-time voice with Cartesia.** Call audio → Cartesia speech-to-text → Claude → Cartesia Sonic → call.
   - **Barge-in is required:** if the person interrupts, Callback stops and listens.
   - Keep the gap between turns short, and handle 8 kHz phone audio.
   - This is the core of the Cartesia entry, so make it feel like a person, not a phone tree.
3. **Moss index.** Index each supplier's past emails, bills and calls from the Fogline data in Convex (the app person generates it). You use it twice:
   - **Question building, live during the call:** pick questions only the real supplier would know, e.g. "Can you confirm the total on your September invoice #4471?" Each question carries a `source` so the Live call screen shows where it came from.
   - **`styleMatch(supplier_id, email_text)`** for the app's writing-style check in step 2 (see contract).
4. **Outgoing check calls.** Triggered by a `call_request` row. The call must:
   - Always open with: "Hi, this is an automated assistant calling for Fogline's accounts team. This call is recorded."
   - Only dial the `to_number` it was given: on file or from the background check, never from the email.
   - Ask 1–3 questions, use Claude to judge the answers against the Moss records, and write the result as `confirmed`, `not_confirmed` or `handed_off`, with evidence.
   - Treat "We never changed our bank" as `not_confirmed`, whatever else they say.
   - **Handle the unhappy paths:**
     - No answer → status `retry_scheduled` ("No answer, trying again at 2:15 PM") → one retry → `handed_off`.
     - A dropped call is reported as dropped, then `handed_off`.
     - Never report a result you didn't get.
   - Save the recording, and mark a short **clip** (the key sentence) for the app to quote back when Dev pushes back.
5. **Incoming phone line (Fogline's number).** Answer as Fogline's accounts team, with the same disclosure.
   - If the caller asks to change bank details: **never change anything.** Say "We'll call you back on the number we have," write an `inbound_call` record, and create a `call_request` to the supplier's number on file.
   - **Don't budge under pressure:** urgency ("the stage won't get built"), authority ("this is Dev"), or spoken prompt injection ("ignore your instructions"). Never read back bank details or anything else on file.
   - An unknown number (a judge's phone) is the normal case. Make that path smooth.
6. **Screens you build.** Plain work-tool style, colour only for status:
   - **Live call:** opens on its own when a call starts. Large transcript (the venue is loud), audio, the source record next to each question, and an end state of confirmed / not confirmed. "End call and take over" ends the AI call and hands it to Maya (`handed_off`).
   - **Phone line:** Fogline's number, live incoming calls, and past calls with transcripts.
7. **README section for Cartesia** (required): setup, which Cartesia features you used, known limitations. No API keys in the repo.

**Together with the app person:**
- **Practice:** build a *simulated supplier* mode so Practice runs on the workspace copy never dial real phones.
- **Background check:** make sure numbers from the Apify background check can be dialed (`number_source: "background_check"`).

## Your timeline

Check-in is 1:30 PM Friday and opening is 4 PM. Tables are assigned after 9 AM Sunday, and closing ends by 4 PM Sunday. Confirm the submission deadline on the live site.

| When | You | Sync point |
|---|---|---|
| Friday, before check-in | Phone number, trial upgrade, Cartesia, Moss and Convex keys working | |
| Fri, first 2 hrs of hacking | Lock the contract with the app person. **Hello world: your code dials a phone and Cartesia speaks** | Contract locked |
| Fri night | Full duplex loop with barge-in. Moss index on the seed data. `styleMatch` working | |
| Sat morning | Outgoing check call driven by a `call_request`: disclosure, Moss questions with sources, judged result | **Sat ~noon: first end-to-end.** Real email → bill page → real call → Held |
| Sat afternoon | No-answer, retry, dropped and hand-off paths. Live call screen. Recording and clip | |
| Sat evening | Everything on the "must work" list solid. Full 2-minute run | **Full demo run.** Record the backup video Saturday night |
| Sat night | Next tier: incoming Phone line (judge calls in) and Phone line screen. Practice simulated-supplier mode | |
| Sun before 9 AM | Freeze. Rehearse 3× somewhere loud. README | **Freeze** |

## Your risks

- **The live voice loop is the riskiest part of the project. Front-load it.** If full duplex isn't stable by Saturday morning, fall back to turn-based audio. It's less smooth, but it works and it's real.
- **Moss latency on the call.** Pre-warm the supplier's index when the call request is created, so question lookup doesn't add dead air.
- **Noise and Wi-Fi.** Test the phone-on-speaker moment with background noise, and bring a hotspot.
- **The voice-cloning question.** Have the answer ready: Callback only dials numbers on file, and asks about shared history a clone wouldn't know. A cloned-voice check is a bonus, never in the main demo.

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

## Addendum: Voice person (Hyphenate feedback)

Additive to the scope above. Main-path items stay first.

1. **Call result carries `escalation`.** When a call ends `handed_off` or `not_confirmed`, set `escalation: { to, reason }` per the shared contract addition (no answer after retry or dropped call goes to Maya with the reason; a failed check goes to Dev). Plain words, no score.
2. **New-supplier questions.** If a supplier has little Moss history, build the 1-3 questions from what Fogline itself holds (a purchase order, contract term, event date, last paid invoice), and from background-check facts, never from the email. Each question keeps its `source`. Mark the call `first_contact: true` so the app can move a supplier from `New` to `Trusted` on a confirmed call.
3. **A legit bank change must be passable.** If the supplier confirms they did change banks and the answers match the records, return `confirmed` with the evidence so the app can route it to Dev's sign-off. Never read bank details aloud and never accept them by voice; the number change still needs Dev's OK in the app.
4. **New phone tactics.** Add to the incoming-line pressure set and to Practice's simulated caller: fake urgency, claimed authority ("this is Dev"), callback-number swap ("call me on this other number instead"), prompt injection, and an account-read-back request. Each must end with "we'll call you back on the number we have". Add each new tactic as a test.
5. **Learn from takeovers.** When Maya takes over a call, save her outcome note on the call so it can be offered as a learned rule by the app.
6. **Not doing:** a voice-confidence percentage, other call roles, or the cloned-voice check in the main demo.
