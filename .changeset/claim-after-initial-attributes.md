---
"@solidjs/web": patch
---

Element claims fire after an element's initial attributes are applied, and the attributes whose writes re-claim are consumer-declared (#3923).

A claim consumer (a router's link-state layer) is told about each `a[href]` / `form[action]` once per mount — with its dynamic `href`, `target`, `rel`, … already applied — instead of at creation before the binding effect's first run. Compiled output claims a static element at creation, an element with bindings at the tail of its binding effect's first run (under the owner captured at creation, since a held mount lands ownerless), and `spread` claims an `a`/`form` it applies after the first application (so `dynamic("a")` anchors are covered too). Writes before the mount claim never re-claim.

Public API:

- `registerElementClaim(handler, options?)` takes an options bag: `{ attributes?: readonly string[] }` names the attributes whose compiler-owned writes (`setAttribute`, `setAttributeNS`, `setProperty`, the spread's property path) re-claim an already claimed element — plain names; `prop:href` and `xlink:href` map to `href`. The write sites consult the union of every registered consumer's set. Default stays `["href", "action"]`, so existing consumers keep today's behaviour. New exported type `ElementClaimOptions`.
- `claimElement(node, owner?)` (compiler-emitted primitive, `@internal`) takes the optional reactive owner the handlers run under.

Without a registered consumer every hook folds away: the three every-page size scenarios (`app: CSR`, `app: compiled CSR`, `app: compiled hydrating`) are byte-identical.
