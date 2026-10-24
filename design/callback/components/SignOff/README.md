A person's approval on a signature line, with their name in italic serif in `signatory` and a guilloche seal. Callback can never complete one.

**Provide** `state` ('signed' | 'awaiting' | 'locked'), `name`, `role`, `time`, and a `reason` for the locked state.

- `signed`: "Approved" with the name in `signatory`, and the seal in `signatory`.
- `awaiting`: what Dev sees on each item in Approvals. The seal is greyed until he signs.
- `locked`: the dashed line Callback gets ("Callback can't approve its own requests"). This is the guardrail, shown on screen.
