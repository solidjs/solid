---
"solid-js": patch
---

Fix SSR `<Loading>` to handle a bare async memo passed directly as its child (e.g. `<Loading>{asyncValue()}</Loading>`). The boundary now catches the synchronous `NotReadyError` from the discovery pass, awaits the underlying source, and re-runs discovery — restoring parity with the client and allowing inner `<Errored>` boundaries to propagate async holes through outer `<Loading>` on the server (issue #2677).
