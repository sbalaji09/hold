Buttons in four variants, plus a `locked` state that explains why an action isn't available and who can take it.

**Provide** `variant`, a verb label, an optional `icon` ('phone' | 'hold' | 'tick' | 'lock' | 'clock' | 'person'), and `locked` (one sentence) when the action is off-limits.

- `primary`: `action` fill. Use one per view: **Pay**, **Approve**, **Run payments**.
- `secondary`: `surface` with a `line-control` border. Use for **Call supplier**, **Reply**, **Reject**.
- `hold`: outlined in `hold`. It is the only coloured button; use it for **Hold** only.
- `ask`: an underlined text query. **Why?** is always an `ask`.
- **Locked, not hidden.** `locked="Callback can't release a held payment. Dev has to approve it."` disables the button, adds a lock and sets the reason underneath in `ink-muted`. Always name who can act.
