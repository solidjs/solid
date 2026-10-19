---
"@solidjs/html": patch
---

Fix the tokenizer treating the first attribute of a dynamic tag as its tag name. `<${Comp} title="...">` or `<${Comp} style=${...}>` entered raw text mode, so the children were read as text and parsing failed with "Unclosed tag".
