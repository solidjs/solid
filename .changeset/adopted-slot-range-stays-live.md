---
"@solidjs/web": patch
---

frames: keep an adopted boundary's slot range reactive. The claim scope wrapped insert's accessor, so the binding's first read ran inside `runWithOwner`'s untracked window — reactive only by accident, via the re-read of whatever accessor that first read returned. A `<Loading>` answering a still-pending streamed fragment returns fallback NODES instead, leaving the effect with no dependency at all and the range permanently inert: the boundary's own resume still claimed the swapped-in server markup, so the region looked right, but nothing downstream ever re-rendered it (in the notes example, every navigation out of a late-settling note changed the URL and nothing else). The claim now wraps the insert CALL, so the first evaluation is the render effect's own compute — still under the producer's hydration keys, but tracked.
