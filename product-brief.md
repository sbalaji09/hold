# Callback — Product Brief

Oct 17, 2026 · @Snehil

## Summary

Scammers email companies pretending to be a supplier: "we switched banks, pay us here now." Callback is an app a company's finance team uses to pay its bills. It pays normal bills on its own. When a bill or bank change looks off, it phones the real supplier on the number already on file, asks a question only they would know, and holds the money if the answer is wrong. It also answers the company's own phone line, so scammers who call in get the same treatment.

**Features:** a review queue of flagged bills, live calls you can watch, a page per supplier with its history, a "why?" on every decision, boss sign-off on big payments, a guarded phone line, and a practice mode that throws fake scams at it to check it still works.

**Demo (2:40):** we open the app as the finance team of Fogline, a made-up music festival. A fake "new bank" email arrives from a supplier's hacked account. Callback calls the real supplier, a phone rings on our table, and the payment is held. The boss says "just pay it," and Callback explains why it won't. In questions, the judge calls Fogline's number from their own phone and tries to change the bank details. It doesn't work.

**Main targets:** Hyphenate ($8k / $5k / $3k), Microsoft Built for the Real World, Cartesia, Moss, Apify. Convex comes along for free.

## Who uses it

Two people at a company open Callback, and Callback itself does the job of a third. Build every screen for one of them, never for a judge.

| Person | What they do in Callback | How often |
| --- | --- | --- |
| **Callback (the agent)** | Reads the bills inbox, checks each bill, pays the safe ones, calls suppliers about risky ones, answers the company's phone line | All day, on its own |
| **Finance team member** (at Fogline: Maya, the bookkeeper) | Looks at what Callback flagged, listens to calls, handles the rare case Callback hands back, adds new suppliers | A few minutes a day |
| **The boss** (at Fogline: Dev, the controller) | Approves payments over $10k and anything Callback won't release on its own. Can ask "why?" and push back. | When pinged |

**What Callback can and can't do.** It can pay normal bills under $10k, hold any payment, and call any supplier. It can't approve its own requests, change a supplier's bank details without a passed call plus the boss's OK, or release a held payment alone. Those limits show up in the app as greyed-out buttons with a reason, not just as rules in a slide.

**The demo customer.** Fogline is a made-up 3-day music festival in San Francisco, two weeks before gates open. Its workspace has about 25 suppliers (stage builder, sound rental, security, artist agencies, food vendors) and 6 months of real-looking bills, emails and payments.

## The app, screen by screen

The app opens on **Today**: what is waiting on the signed-in person, then one section per part of the job, each row opening its record. There's still no landing page or stats page: no totals, charts or counters. A sidebar on the left links every screen below.

| Screen | What you see | What you can do |
| --- | --- | --- |
| **Inbox** (home) | Every incoming bill and supplier email, newest first, each with a status: Paid, Scheduled, Checking, Calling, Held, Needs you | Filter by status, open any item |
| **Bill page** | The original email and invoice on the left. On the right, Callback's checks, each with its evidence ("bank account never used before", "domain registered 4 days ago", "writing doesn't match this supplier's last 14 emails"), plus a timeline of everything that happened to this bill | Pay, hold or call the supplier. Buttons Callback isn't allowed to use show greyed out with the reason. Ask "why?" in plain words. |
| **Live call** | Opens when a call starts: the transcript appearing as people talk, the audio, and next to each question Callback asks, the record it came from ("September invoice #4471"). Ends with a result: confirmed or not confirmed. | Listen in, or end the call and take over. Afterwards the recording and transcript stay on the bill. |
| **Suppliers** | A list of suppliers. Each supplier page shows the trusted phone number and when it was last checked, bank details and every change to them with how it was verified, past bills, past calls, and background-check results for new suppliers | Add a supplier, which runs a background check (website, business registry, Google Maps, domain age). Edit contacts. |
| **Approvals** (the boss's screen) | Everything waiting on the boss: big payments, held payments, bank changes. Each shows Callback's recommendation and evidence. | Approve, reject, or reply. If the boss pushes back ("just pay it"), Callback answers with the evidence and offers a safe alternative, like paying the old verified account. |
| **Payments** | This week's payment run: which bills go out, to which account, and their status | Run payments. Money goes out through a test bank (Increase sandbox), and each payment shows its transfer ID. |
| **Phone line** | Fogline's phone number, live incoming calls, and past calls with transcripts | Listen in. Callback never changes bank details from an incoming call. It says "we'll call you back on the number we have" and starts an outgoing check call. |
| **Practice** | A set of fake scam emails, written by Claude, and whether Callback caught each one last time it ran | Run the set against a copy of the workspace after any change, like running tests. Click **Try a scam** to write your own; it lands in the real inbox. |
| **Activity log** | Every action by Callback, Maya and Dev: who, when, what, why | Search, filter, open the item it touched |

## App map

&#91;embedded content: app map · 9 screens\]

Bills, fake scams and phone calls all land in the Inbox. From a bill's page, Callback calls the supplier, asks the boss, or pays, and every step goes into the Activity log.

## How it works underneath

Each bill goes through five steps. Every sponsor tool has one real job in them.

1. **A bill arrives** at Fogline's real bills email address. Anyone can email it, judges included.
2. **Callback checks it** for a bank account it hasn't seen, a look-alike domain or copied website, rush language, an unusual amount, an account on the shared scam blocklist, and writing that doesn't match the supplier's past emails.
3. **It decides.** Safe and under $10k: pay. Safe but over $10k: ask the boss. Risky: call the supplier.
4. **It calls** the number on file and asks questions built from the supplier's real history. The answers decide whether the bill is paid or held.
5. **It records everything** in the activity log and on the bill page.

| Sponsor | Its job in Callback | Priority |
| --- | --- | --- |
| **Hyphenate** | Not a tool; the whole product is the entry. Seats line: "Callback fills the bills-payment and supplier-records seats on a finance team, and answers to the controller." | Main target |
| **Microsoft Built for the Real World** | Not a tool. Judged on customer understanding, measurable usefulness, path to production, responsible design and working end to end. See the next section. | Main target |
| **Cartesia** | The voice on every call, both outgoing check calls and the incoming phone line. Voice is the core of the product, not an add-on. | Main target |
| **Moss** | Instant search over each supplier's past emails, bills and calls. Used during the live call to pick questions, and in step 2 to compare writing style. This is their "voice agent that acts in real time" example. | Main target |
| **Apify** | Two jobs. (1) Background check on new suppliers: website, business registry, Google Maps listing, domain age, which is where a trusted phone number comes from. (2) Copycat check: when an email comes from an unfamiliar domain, scrape its website and the real supplier's and flag a copied site ("this site was copied from the real one and registered 4 days ago"). Publish both as one "supplier verifier" Actor for the Best Actor prize. | Main target |
| **Convex** | The real-time database, so Maya's and Dev's screens update the moment Callback acts. We need one anyway. | Secondary |
| **Anthropic** | Claude reads bills, writes the call questions, judges the answers and writes the Practice scams | Enter if their prize is posted |
| **Factory** | Only if their Droid SDK can run the bill-check agent without a rewrite. Their criteria (trigger, limits, visible work) match ours. | Check at their workshop, else skip |
| **Skipping** | Creao, CRS, SpaceXAI (requires Cursor, Grok Imagine or Voice, and a space theme), Visa (shopping) |  |

Payments go through the Increase sandbox (a test bank with pretend money, listed in Hyphenate's brief). Everything else lives in Convex.

## Responsible design and path to production

Microsoft and Cartesia both score this directly, and Hyphenate's "would you hire it?" is the same question.

**On every call:**

- Callback opens with "Hi, this is an automated assistant calling for Fogline's accounts team" and says the call is recorded.
- It only calls numbers already on file or found by the background check, never a number from the email.
- If the person interrupts, it stops and listens. If no one answers, it tries again and then hands off to Maya. It never pays on a guess.

**Limits and privacy:**

- It can't approve its own payments, change bank details alone, or release a held payment.
- Recordings and transcripts stay on the bill they belong to, and are visible only to Fogline's team.
- No real people's data: all of Fogline is made up, and the background check reads only public business pages.

**How it becomes a real product:**

- Plugs into what a finance team already has: a shared bills inbox, accounting software like QuickBooks or NetSuite, and its bank. For the demo, those are a real inbox, our database and the Increase sandbox.
- Starts in "watch only" mode, flagging and calling without moving money, until the team trusts it.
- **Measurable:** scams caught vs missed on the Practice set, real bank changes wrongly held, and minutes per check call vs a person doing it by hand. Show these as real counts in the app, never as a slide.

**README (Cartesia requires it):** setup, which Cartesia features we used, and known limitations. Source is shared with judges, with no API keys in the repo.

## Demo

The pitch is 2:40, with 20 seconds of slack before the 3-minute cut. The whole thing is someone using the app: no slides, no title screen, no stats page, and no Practice. Numbers are said out loud, never put on a screen. The app is called **hold** on screen, so say "hold".

Tables are shared by 2–3 teams and it will be loud. Make the live transcript large, and hold the ringing phone close to the judge on speaker.

| Time | What we do | What the judge sees | Say |
| --- | --- | --- | --- |
| Before | App on **Today** as Maya: what's waiting on her, then calls, bills, payments, suppliers and what hold did last. The scam email is drafted on a teammate's phone, from the stage builder's address. | A real-looking inbox, most bills Paid or Scheduled | |
| 0:00–0:15 | Teammate presses Send at the first word, so the email lands while we talk | The Inbox | The hook (below) |
| 0:15–0:35 | The bill pops into "Bills hold is working on" as Checking, then Calling. Open it. | Two flags with their evidence: a bank account never paid before, and writing that doesn't match the supplier's past emails | "hold has paid Stagecraft eleven times, always to the same account. This one asks for a new one, and it doesn't write like Rosa. So it's calling her." |
| 0:35–1:05 | The live call opens on its own. The teammate playing Rosa answers on speaker and gives a rounded total: "Around eighteen thousand, I think." | hold says it's an automated assistant, asks for the total on September's invoice #4471 with the record beside the question. Then it says "One moment, I'm just checking that with the team," and a card appears for Maya: the question, Rosa's words and the $18,400.00 on file. | "hold isn't sure, so it asks Maya instead of guessing." |
| 1:05–1:35 | Maya clicks **Matches**. hold thanks Rosa and asks the bank question. | "We never changed our bank." Status: **Held**. The result shows Maya judged the first answer. | Nothing. Let the call play. |
| 1:35–2:10 | Switch to Dev, open Approvals. Dev types: "Release it, we'll miss the stage build." | hold replies with the call clip and the evidence, and offers to pay the old, verified account. Dev approves that. | "The boss can push back. hold answers with what it heard and a safe way to pay." |
| 2:10–2:25 | Payments: Run payments | The transfer to the verified account, with its test-bank transfer ID | "Real money movement, in a test bank." |
| 2:25–2:40 | Back to Today | "What happened last" lists every step of the last two minutes, with who and why | The close (below) |
| 2:40–3:00 | Slack. Absorbs a slow email or a long call. | | |

**If it runs long:** cut Payments first (end on Dev's approval), then the Activity log (say the close over Approvals). Never cut the call. Maya must click within 20 seconds of the card appearing, or hold counts the answer as not matching on its own; the call still ends Held, just without the human moment.

**What to say**

- **Hook:** "Last year US businesses lost about $3 billion to fake supplier emails. Every fraud guide gives the same fix: call the supplier on a number you already have. hold makes that call. We're Fogline, a music festival, and a bill just came in."
- **Close:** "hold does the bills-payment job at Fogline. It answers to the controller, it can't approve its own payments, and every answer it gets on a call becomes a rule it uses next time."

**Checklist before going up**

- Reseed the workspace, persona on Maya, Watch only off, Increase keys set in Convex.
- Start the voice server once beforehand so Moss is warm. Set `TWILIO_AMD=false` so a person on speaker isn't taken for a voicemail.
- Phone volume down far enough that hold's voice doesn't leak back into the mic.
- Run the whole thing once, start to finish, after the last code change. To rehearse the Maya card without a phone, open `/calls/call_mock?mock=ask` on `next dev`.

**Questions.** Hand the judge a card with Fogline's phone number and bills email. They call from their own phone as a "supplier" asking to change bank details; hold says it will call back on the number on file, and the call's recording and transcript appear on the Phone line. Or they email the bills address. If a judge has more time: open the supplier's page for its bank-change history and the rule hold learned from the call. If asked "what's next?": the same scam runs in reverse, with criminals posing as a company to its suppliers, and the same check call protects them.

**Demo video (Hyphenate requires it):** open on the phone ringing and "we never changed our bank," then show the same flow.

**Backup:** record a clean run Saturday night. If the venue phone line or Wi-Fi fails, say so and play it. Never fake a live call.

## Build rules: real software, not a stats website

The test for every screen: if a real bookkeeper sat down at it Monday morning, could they do their job without us explaining it?

1. **No landing page.** The link opens straight into Fogline's Inbox, logged in. No hero banner, no marketing copy, no "How it works" section inside the app.
2. **No hardcoded numbers.** Every number on screen is counted from the workspace data. If you can't click it and open what's behind it, it doesn't belong.
3. **Every screen has a next action.** If Maya or Dev can't do anything on a screen, cut it. No "insights" or "impact" pages.
4. **Real triggers only.** The scam is a real email to a real inbox, the call is a real phone call, and the payment is a real test-bank transfer. No hidden "run demo" button.
5. **Mostly boring data.** Six months of normal bills, so the inbox looks like a real company's: mostly dull, with one problem in it.
6. **Show the agent's work where it happens.** Its checks and reasoning live on the bill page and the live call screen, not in a separate scrolling "AI console."
7. **Look like a work tool.** Think Gmail, Linear or Ramp: tables, plain type, neutral colours, colour only for status (Paid, Held, Needs you).
8. **Handle the unhappy paths.** Supplier doesn't pick up? "No answer, trying again at 2:15 PM." Call drops? Say so. These states are what make it feel real.
9. **Let judges use it.** A second laptop is logged in as Dev, the boss. The phone number and bills email are on a printed card.

## Scope for a team of two

One person owns the voice side, the other owns the app and data. They meet at the bill page.

| Person | Owns |
| --- | --- |
| **Voice** | Outgoing check calls, incoming phone line, live call screen, building questions from Moss lookups, turning a call into confirmed / not confirmed |
| **App** | Inbox, bill page and its checks, Approvals with "why?", Payments through the test bank, Activity log, Fogline's data |
| **Together** | Practice, supplier background check |

| Priority | Features |
| --- | --- |
| **Must work by Saturday night** | Fogline's data with planted scams, Inbox, bill page, outgoing call (with AI disclosure and no-answer handling), Approvals with pushback, Payments, Activity log, all on Convex |
| **Next** | Phone line (judge calls in), Practice with Claude's fake scams, Apify background check and copycat check (Suppliers page and bill page), published as an Actor |
| **Bonus, never in the main demo** | Shared scam blocklist across companies, cloned-voice check |

### What's real and what's simulated

| Real | Simulated |
| --- | --- |
| Phone calls, both directions | Fogline, its staff and its suppliers |
| Emails into the bills inbox | Six months of past bills and emails (generated, with a list of every planted scam) |
| Callback's checks and decisions | The supplier who answers the call (a teammate) |
| Test-bank transfers (Increase sandbox) | The money itself (pretend) |
| Background checks on real public websites |  |

### Not building

A landing page, charts or an analytics dashboard, Visa payments, a mobile app, a QuickBooks connection, general bookkeeping checks like double bills, or the reverse scam (fake orders placed in Fogline's name). No Creao, CRS or SpaceXAI integrations either. Callback does one job: stopping payment scams.


## Hyphenate feedback and judging lens (added Oct 2026)

Feedback from Hyphenate: adapt to new fraud techniques, make the agent loop work beyond fraud, keep the real-world use clear (the music festival is interesting), show self-improvement and a human in the loop, adapt to new suppliers, and give a view of all suppliers. Added without changing anything above.

**Their four questions.** *Real:* real-enough data with the mess left in, and an answer key (our planted-scam list). *Hireable:* one role, asks the right person, every action traces to a record. *New:* something new (the check call). *Wow:* one moment (the phone rings, the payment is held).

**The loop.** Learns from history, runs on its own, escalates to a named person with the reason in words (holding only that item), improves by saving the answer as a rule so it is never asked again. The loop is the platform and payment scams are its first role. We pitch this in one line and do not build other roles.

**Additive features.** (1) Learned rules per supplier, shown on the supplier page and cited later, never relaxing the hard limits. (2) Practice is a regression suite: missed or reported scams join it, and Claude can generate fresh variants. (3) New suppliers start as `New`: background check first, first bank change or large bill always gets a call, `Trusted` after the first confirmed call. (4) Escalations show who they are routed to and why, with no score. (5) The Suppliers list shows every supplier with status, last checked and open items.

**Demo.** See the Demo section: a 2:40 run with no Practice, and Maya answering hold mid-call. If a judge has more time: show the learned rule on the supplier page.

**Still not building.** Other finance roles, bookkeeping checks, the reverse scam. Details are in the shared addendum at the end of `plan-agent.md` and `plan-voice.md`.
