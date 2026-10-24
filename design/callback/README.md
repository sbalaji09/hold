Callback is the accounts-payable clerk at Fogline. It pays normal bills on its own and phones the supplier, on the number already on file, when a bank change looks wrong. The design language is **the security-printed ledger**: the materials banks have always used to make money hard to fake. That means engraved serif letterhead, MICR lines, guilloche seals, courtesy-amount boxes and serial-number red, applied with the restraint of a private bank's statement. It is a dense, quiet work tool, and its distinctiveness comes from these materials rather than from colour or decoration.

## Principles

1. **Quiet by default.** Most bills are fine, so most of the screen is `ink` and `ink-muted` on `paper` and `surface`. Paid is an outline. A normal Tuesday should look calm.
2. **Colour is reserved for attention.** Four hues, each with a single meaning (table below). Nothing else gets colour: no tinted headers, no coloured nav icons, no charts.
3. **Every claim cites its record.** Evidence, call questions and Why? answers carry a `Cite`. If Callback can't point at a record, it doesn't make the claim.
4. **Show the words, not a score.** Suspicious phrases are quoted and marked (`CheckRow` `flag`). Never show "risk 0.82".
5. **Locked, not hidden.** Callback's limits are part of the product. An action it can't take is a `Button` with `locked`, and an approval it can't give is a dashed `SignOff`.
6. **The unhappy path is designed.** "Rang 6 times. Trying again at 2:15 PM." "Line dropped at 00:48. Calling back." These are states, not error toasts.

## Colour

Two themes: **Paper** (`light`, the default) and **Vault** (`dark`). Every text pair named in a token's usage meets 4.5:1 in both themes; control borders and the focus ring meet 3:1.

| Role | Tokens | Meaning |
| --- | --- | --- |
| Ground and documents | `paper`, `surface`, `surface-sunk`, `line` | The desk, and the documents on it |
| Ink | `ink`, `ink-muted` | Recorded and settled. Everything Callback states. |
| Graphite | `graphite`, `graphite-tint` | Provisional: Callback is still checking |
| Brass | `brass`, `brass-tint`, `brass-solid` | A phone line is open right now |
| Serial red | `hold`, `hold-tint`, `hold-solid` | Money stopped |
| Signatory blue | `signatory`, `signatory-tint` | A person: their turn, their words, their sign-off |

- **Callback states; people sign.** Callback's own words are set in mono, in `ink`. Maya's and Dev's names, initials and quoted reasons are in `signatory`, set in italic serif. You can tell agent from human anywhere in the product.
- The main action is `action` (ink), not a hue.
- Every status carries a glyph and a word as well as a colour, so no state depends on colour alone. Serial red and brass also differ clearly in lightness.

## Type

Three families, loaded from Google Fonts via the `@import` in `components/bundle.css`.

- **Letterhead, Newsreader** (`--font-serif`): `display` (30/36) for screen titles; `subject` (24/30) for a bill's subject or a supplier's name; `signatory` (20/26 italic) for a person's name on a sign-off. Never use it in tables or buttons.
- **Desk, Schibsted Grotesk** (`--font-sans`): `heading`, `body`, `body-strong`, `small`, and `caps` (10.5px, +0.09em). `caps` is the only uppercase in the product, used for marks, column heads and captions.
- **Record, DM Mono** (`--font-mono`): `amount-lg` and `amount` for money; `statement` for anything Callback says or writes; `record` for anything copied from a record (invoice numbers, MICR lines, phone numbers, transfer IDs, timecodes).

## Security printing

These four motifs are the signature of the system. Each has one job, and none is used as decoration.

- **Guilloche** (`Guilloche`): woven sine strands, generated from code. It is the seal behind a decision, inside `Endorsement` and `SignOff`, and on the cover. Nowhere else.
- **Microline** (`.cb-micro`): fine diagonal `microline` hatching on `surface-sunk`. It sits behind money and quoted evidence (the courtesy box and check quotes), the parts worth forging.
- **MICR line** (`AccountLine`): bank accounts set with the E-13B transit and on-us symbols, like the bottom of a cheque.
- **Courtesy box** (`Amount size="lg"`): the amount padded with protective asterisks, `$***18,400.00`.

## Voice

Callback writes like a senior AP clerk: short, specific, past tense, unexcited.

- **Real numbers, measured against the supplier's own history.** "Fogline has paid Stagecraft 11 times since April, always to Chase ··2210. This bill asks for Mercury ··8817."
- **Name who can act.** "Callback can't release a held payment. Dev has to approve it."
- **On calls, first person as Fogline's accounts desk.** "Before I update anything: your September invoice for the main-stage truss. What was the invoice number?" Inside the product it never says "I". The log reads "Callback held $18,400.00 to Mercury ··8817."
- **Push back with evidence and a safe alternative.** Dev writes: "Release it, we'll miss the stage build." Callback replies: "Rosa confirmed they never changed banks. I can pay the verified Chase ··2210 account today."
- **Avoid:** fraud score, AI-powered, smart, insights, magic, seamless, "Oops", emoji, exclamation marks.
- **Formats:** `$18,400.00`, `··2210`, `10:43 AM`, `Oct 21`, `(415) 555-0142`, timecodes as `01:12`.
- **No numbers that can't be clicked.** No loss banners and no "scams stopped" counters.

## Layout

The app opens straight into the Inbox, signed in as Maya.

- **Sidebar** (`sidebar-width`) on `surface-sunk`: Inbox, Approvals (with a `signatory-tint` count), Payments, Suppliers, Phone line, Practice, Activity log.
- **Ledgers**: `caps` column heads over a 1.5px `ink` rule, `row-height` rows, `line` rules between rows, newest first.
- **Bill page**: the original email as a document on the left, with a mono header, sans body, then the courtesy `Amount` and `AccountLine`, and the `Endorsement` once Callback decides. On the right (`evidence-width`): the checks, the call's `Line`, and the `SignOff` waiting for Dev. See the Bill page card.
- **Live call**: `Line` on top, then the transcript with timecodes and sources in a `margin-width` margin.
- **Spacing** follows a 4px scale: `space-3` for cells, `space-4` for document padding, `space-5` between sections, `space-6` for the screen gutter.

## Shape, depth, motion

- Corners stay small: `radius-xs` for marks and references, `radius-sm` for buttons, `radius-md` for documents. `radius-round` is only for indicators and initials.
- Documents rest on the desk with `shadow-doc` (a hairline plus a long, faint fall). Popovers use `shadow-pop`. Nothing else is raised.
- Motion is minimal: a live indicator's ring pulses, an endorsement settles in over 240ms, and Callback's speaking line shows a hairline caret. Everything stops under `prefers-reduced-motion`.
- Focus is a solid 2px `ink` outline with a 2px offset, in both themes.

## Iconography and wordmark

Glyphs (tick, cross, query, clock, person, hold, lock, phone, and the MICR symbols) live in the bundle on a 16px grid with a 1.5 stroke, in `currentColor`. For sidebar icons, use Lucide at 16px with a 1.5 stroke in `ink-muted`; that's a stand-in, not part of the system. No emoji, sparkles or robots. There's no logo file: set **Callback** in Newsreader 500 at −0.025em, in `ink`.

## Components

`Button` · `StatusMark` · `Endorsement` · `SignOff` · `Guilloche` · `Amount` · `AccountLine` · `Cite` · `CheckRow` · `Line` · `TranscriptLine` · `LogEntry` · `InboxRow`, plus a composed **Bill page** card. Load React 18, then `components/bundle.css` and `components/bundle.js`; everything is on `window.Callback`. Preview data comes from Fogline, the fictional festival in the demo: Maya Lin (bookkeeper), Dev Okafor (controller), and Rosa Quintero at Stagecraft Rigging Co.
