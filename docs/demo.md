# Demo script (one approver)

The brief's Demo section, rewritten for the app as built: one approver (you), no persona switch, bills sent from the Inbox's **Send a bill** (inbound email is deferred). 2:40, with 20 seconds of slack. Say "hold".

| Time | What we do | What the judge sees | Say |
| --- | --- | --- | --- |
| Before | App on **Today**. Teammate holding the `DEMO_PAYEE_PHONE` phone plays Rosa. | A real-looking workspace: Scheduled bills in Payments, "How hold is doing", an empty "What happened last" | |
| 0:00–0:15 | Inbox → **Send a bill** → **Bank change** → Send, on the first word of the hook | The Stagecraft bill appears as Checking | The hook (below) |
| 0:15–0:35 | The bill turns to Calling. Open it. | Pay to: First Republic ··7743, **Never paid before**. Flags with evidence: new account, rush language, writing style | "hold has paid Stagecraft eleven times, always to the same account. This one asks for a new one, and it doesn't write like Rosa. So it's calling her." |
| 0:35–1:05 | The live call opens on its own. Rosa answers on speaker and gives a rounded total: "Around eighteen thousand, I think." | hold says it's an automated assistant and asks for the total on invoice #4471. Then "One moment, I'm just checking that with the team," and the **hold needs you** card: the question, what Rosa said, the $18,400.00 on file, a draining 20-second bar | "hold isn't sure, so it asks me instead of guessing." |
| 1:05–1:35 | Click **Matches**. hold asks the bank question. | "We never changed our bank." Status **Held**. The result shows you judged the first answer. | Nothing. Let the call play. |
| 1:35–2:10 | Bill page: **hold learned from this call** → **Keep rule**. Then Approvals: type "Release it, we'll miss the stage build." | The rule saved for Stagecraft. hold replies with the call clip and evidence and offers to pay the old, verified account. Approve that. | "Every answer it gets on a call becomes a rule. And I can push back; hold answers with what it heard and a safe way to pay." |
| 2:10–2:25 | Payments → **Run payments** | The transfer to the verified account with its test-bank transfer ID, next to this week's Scheduled bills | "Real money movement, in a test bank." |
| 2:25–2:40 | Back to Today | "What happened last" lists every step, who and why; "How hold is doing" counts it | The close (below) |

**If it runs long:** cut Payments first, then Today. Never cut the call. Click within 20 seconds of the card appearing, or hold leaves the answer for review after the call.

**Hook:** "Last year US businesses lost about $3 billion to fake supplier emails. Every fraud guide gives the same fix: call the supplier on a number you already have. hold makes that call. We're Fogline, a music festival, and a bill just came in."

**Close:** "hold does the bills-payment job at Fogline. It answers to the controller, it can't approve its own payments, and every answer it gets on a call becomes a rule it uses next time."

## Checklist before going up

- `pnpm seed` (never during a call). Today shows **Available for hold's questions** (not Away); Payments shows **Watch only: off**.
- Increase keys set in Convex (`INCREASE_API_KEY`, `INCREASE_ACCOUNT_ID`), `CALLING_HOURS` unset, `TWILIO_AMD=false`.
- Exactly one machine runs the voice server on the ngrok domain; Today must not say the phone line is offline. Start it once beforehand so Moss is warm.
- Open **Practice** once and **Run all**, so "How hold is doing" shows the regression result.
- Phone volume low enough that hold's voice doesn't leak back into the mic.
- One full run after the last code change. Rehearse the card without a phone at `/calls/call_mock?mock=ask` on `next dev`.

## Questions

Hand the judge a card with Fogline's number. If they don't call, we call it ourselves from a phone not on file, as "Rosa from Stagecraft", and ask to change the bank details. hold refuses, says it will call back on the number on file, and the call (recording, transcript, Flagged) plus the queued call back show on the **Phone line**. With more time: the supplier page's bank history and learned rule, then send another Bank change and show "Learned rule applies" on the new bill.
