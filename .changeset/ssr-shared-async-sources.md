---
"solid-js": patch
"@solidjs/web": patch
---

SSR: one async source, every reader. A generator yields to one reader, so under a server render the serializer pumping a memo's answer `{ meta, progress: gen }` and a memo reading `answer().progress` split the generator's yields between them (the client received half the sequence; the reading memo could miss V1). Every async iterable the runtime reads on the server now goes through a seat on a shared multicast of the source (`shareAsyncIterable`, `solid-js/internal`): one pump, the whole sequence for every seat, a log trimmed to the slowest open seat, the last seat out closes the source. The serializer takes its seat through the border walk (`toBorderForm`, formerly `envelopeContainerTraces`) at `context.serialize` — for iterables nested anywhere in a memo's resolved value on the document face, and for frame slot args — and the frame sink's first-yield tap for document-face slot args uses the same seats, so a server component reading a source it also passes across no longer splits it.
