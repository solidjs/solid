---
"@solidjs/web": patch
---

Server-component mounts pass their raw client props to the frame runtime for behavior-claim resolution: ref/on\* positions on server-rendered elements (compiled under the `serverComponents` option) resolve by prop name through the mounted frame's live props at dispatch and materialize time.
