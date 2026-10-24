A bank account set like a cheque's MICR line (bank, transit symbols, routing number, last four, on-us symbol), with how Callback knows it's real.

**Provide** `bank`, `routing`, `last4`, `state` ('verified' | 'new') and a `note` for verified accounts ("Verified by call · Mar 4").

- `new` underlines the last four in `hold` and adds NEVER PAID BEFORE. Place it directly under the courtesy amount.
- Show only the last four digits of an account number. A routing number is public.
