One numbered check in Callback's review of a bill: the verdict, the evidence, the exact words that gave it away, and the source records.

**Provide** `n`, `result` ('pass' | 'fail' | 'warn'), `title` (the verdict as a fact), `evidence`, optional `quote` plus `flag` (the phrase within the quote to mark), and `sources`. Stack checks in a `.cb-doc` with `role="list"`.

- A fail is a white × on `hold-solid`. A warn is a `graphite` ? in a hairline box. A pass is a muted tick on a single line.
- `flag` gets a `hold` underline with a `hold-tint` highlighter inside a microline quote block. Show the words, never a score.
- Order checks fail, then warn, then pass.
