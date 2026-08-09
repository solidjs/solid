---
"solid-js": patch
"@solidjs/web": patch
---

Document-face live holes (Stage 4): `inServerComponentScope` gates live-hole arming and the iterable-memo pump to server-component render barriers on the document face, and the frames client pumps the `sc:live` channel record — one module-level reader broadcasting hole/attr ops to every adopted boundary (geometry routes; a log replay catches up boundaries that adopt after ops arrived, and call-driven streams supersede document ops).
