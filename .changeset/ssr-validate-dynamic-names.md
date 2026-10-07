---
"@solidjs/web": patch
---

SSR validates dynamic attribute and tag names: a spread key the HTML parser would not read back as one attribute name (whitespace, quotes, `<`, `>`, `/`, `=`, control characters, or empty) is dropped, as the client's `setAttribute` refuses it; other names are written as is (`&` is no longer escaped to `&amp;`, which the parser keeps literally in a name). A `<Dynamic>`/`ssrElement` tag that is not one element name throws, as the client's `createElement` does.
