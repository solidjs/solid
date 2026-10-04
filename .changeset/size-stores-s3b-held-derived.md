---
"@solidjs/signals": patch
---

Stores on L2, S3b: holds on derived stores. A pass reading a key a held batch left unchanged reads committed and holds no one (#3706); a mainline setter above a held adoption publishes mainline for the keys the hold did not change (#3688); a user write to a key whose staging is a held derivation becomes the draft's prior state and the hold re-derives over it (A34 (3), #3612 — `CONFIG_MANUAL_WRITE` discriminates a user's proposal from the derive's derivation).
