---
"@solidjs/html": patch
---

Support `{/* ... */}` style comments in tagged JSX templates, in addition to `<!-- ... -->` HTML comments. They are skipped at tokenize time, can contain template expressions, and may span string chunks.
