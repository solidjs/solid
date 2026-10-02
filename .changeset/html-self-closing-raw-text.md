---
"@solidjs/html": patch
---

Fix the tokenizer staying in raw text mode after a self-closing raw text element such as `<textarea />`, which swallowed the rest of the template as text.
