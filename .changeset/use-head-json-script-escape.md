---
"@solidjs/web": patch
---

Escape every `<` in `useHead` JSON script bodies as `\u003C`. JSON here means `importmap`, `speculationrules` and the JSON MIME types (`application/json`, `text/json`, any `+json` subtype such as `application/ld+json`). Only `</script` was rewritten before, so a JSON-LD value like `<!--<script>` put the HTML tokenizer in the double-escaped state, and the markup after the script became script text up to a later `</script>` or the end of the document. The escaped form parses back to the same JSON. The client writes and compares the same text, so hydration adopts the server's element instead of replacing it; a `</script>` inside JSON no longer causes that replacement either. Other scripts and data blocks keep their current body.
