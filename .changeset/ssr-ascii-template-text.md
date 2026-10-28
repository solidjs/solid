---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

SSR templates write characters above U+00FF in static text and quoted attribute values as numeric character references (`→` becomes `&#8594;`), as do the static attributes baked into a spread element's attribute string. One character above U+00FF in a template made V8 store the whole rendered page as a two-byte string, which roughly doubled the cost of flattening and UTF-8 encoding the response (#4328). Latin-1 characters stay literal. Tag internals, comments, raw-text bodies such as `<script>` and `<style>`, and the children of a spread `<script>` or `<style>` keep their characters, since browsers do not decode references there. Client output is unchanged.
