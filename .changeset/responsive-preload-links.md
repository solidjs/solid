---
"@solidjs/web": patch
---

Support `imagesrcset` and `imagesizes` in typed image preloads, including the standard form without `href`. Candidate URLs inside `imagesrcset` must already be resolved by the integration.

The responsive pair is image-only. On any other destination the attribute is dropped and the link still ships — an integration that computes `imagesrcset` for every asset keeps its script and style preloads. An empty or non-string value counts as absent for the same reason, so a source set is never emitted as garbage the browser cannot parse. A descriptor whose only source was such a filtered attribute is dropped entirely rather than emitted as a `<link rel="preload">` with nothing to fetch.

`mountHeadResource` can adopt a source-set link: it has no href, so it matches a server-emitted link on a null href plus the identity qualifiers — the rule the frame client already applied.

Development builds warn when `imagesrcset` uses a width descriptor without `imagesizes` (the source size falls back to `100vw`, so the preload can miss the image the `<img>` selects), and when a manifest source set carries a relative candidate — candidates are not joined with `_base`, so they resolve against the document URL whichever base the manifest declares. That check walks the source set the way the spec's parser does, so commas inside a candidate URL are not mistaken for candidate separators.
