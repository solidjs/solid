---
"@solidjs/signals": patch
---

Pre-shape object proxy targets with a constructor: the two overlay fields added for #3044 pushed bare-literal targets past V8's fast-properties limit (~19 named props), turning every trap field read into a dictionary lookup — a 15% deep-store reconcile regression. Declared in-object slots restore fast maps with headroom for future fields; array targets are unaffected.
