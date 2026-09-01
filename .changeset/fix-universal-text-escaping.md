---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Universal text is text (#3127). The DOM and SSR generators splice static
text into an HTML template that a parser later unescapes, so they escape
static values and keep JSX entities as written. The universal generator
hands strings straight to the host — `createTextNode`, `setProp` — with no
parser downstream, so the escaping rendered literally (`{"<b>"}` showed as
`&lt;b>`) and entities never decoded (`&lt;` showed as `&lt;`), leaving no
spelling that produced a literal `<` in static text under a custom
renderer. Universal-rendered element children now pass static values
through unescaped and decode JSX entities in text and string attributes,
matching what component children and fragment text always did. The flag
rides on the element, not the config, so `generate: "dynamic"` decides per
renderer. Applied to both compilers; the attribute half closed ten pinned
cross-mode parity divergences between them. Reported with the fix mapped
out by @antoinevanwel.
