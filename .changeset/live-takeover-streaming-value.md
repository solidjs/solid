---
"solid-js": patch
---

A live source whose server value is still streaming when the root hydration pass ends now takes over when hydration ends, not when the root pass ends. Before, a source created in the shell and read by a streamed `<Loading>` boundary connected before that boundary's fragment arrived, so the boundary could not claim its server-rendered DOM and rendered a second copy beside it.
