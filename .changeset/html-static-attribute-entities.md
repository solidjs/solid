---
"@solidjs/html": patch
---

Decode character references in static attribute values. `placeholder="Search&hellip;"` rendered the literal `&hellip;`, an `href` with `&amp;` kept it in the URL, and components received static props like `"a &amp; b"` undecoded. Values are now decoded once with the HTML parser's quoted-attribute rules, as text children already were.
