---
"@solidjs/web": patch
---

Take ownership of every promise the decoder mints from a peer's bytes. The encode side has always kept a fallback owner on the promises it creates (`guardFailures`); the decode side owned none of them, and seroval's atomic promise node settles synchronously inside `fromCrossJSON`, so `createJSONDeserializer.abort`'s sweep — which already defused the constructor spelling — never saw it. A 115-byte argument body encoding a rejected promise therefore answered `200`, ran the function, and then ended the process on Node's default unhandled-rejection policy, from any client that can send a raw request. Ownership is now taken where promises are minted, which covers both spellings because both park the bare promise in the deserializer's `refs` map; `abort`'s half-guard is deleted as the second half of the same guard rather than kept as a second one.
