---
"@solidjs/web": patch
---

Fix the end of a streamed render racing a suspended shell. A `<Loading>` fragment settling while the shell was still suspended (a lazy memo throwing `NotReadyError` above it) could empty the fragment registry before the shell's root holes re-pulled, and the render flushed its serializer then: everything the re-pull serialized was dropped from the hydration data, and the awaited form (`renderToStream(...).then`) completed with an empty document — or, with an `<Errored>` holding the suspended subtree, never completed. The end of the response now waits for pending root holes.
