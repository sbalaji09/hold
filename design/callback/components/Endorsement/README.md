The formal mark placed on a document when Callback decides: a double-ruled frame with a guilloche seal, a serif statement and a caption.

**Provide** `kind` ('held' | 'void' | 'paid' | 'confirmed'), `meta` (date · time · actor, or a transfer ID), optional children to override the wording, and `animate={false}` for history.

- Place it on the invoice document, aligned to the document's bottom-right padding (`space-5`). Keep it level, never rotated.
- Held and Void are in `hold`. Paid and Confirmed are in `ink-muted`, because the normal outcome stays quiet.
- Use one per document. In tables, use `StatusMark`.
- It appears with a 240ms settle (opacity plus 1.04 → 1 scale). Reduced motion turns this off.
