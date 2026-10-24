One phone call. The indicator is lit and pulsing only while the line is open.

**Provide** `state` ('ringing' | 'connected' | 'no-answer' | 'dropped' | 'confirmed' | 'not-confirmed'), `supplier`, `number` (always the number on file), `source` ("on file since Apr 2"), `elapsed` and `note`.

- While live, a 3px `brass-tint` rule runs along the top. `connected` shows a hairline waveform that falls silent after the last speech.
- `not-confirmed` turns the top rule and the indicator `hold`. `confirmed` stays neutral.
- No answer and a dropped line are states, not errors: "Rang 6 times. Trying again at 2:15 PM."
