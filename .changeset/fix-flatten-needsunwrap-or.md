---
"@solidjs/signals": patch
---

Fix `flattenArray` overwriting its `needsUnwrap` flag with a nested call's result instead of OR-ing it (#3133). Under `doNotUnwrap`, an accessor child (a `<For>`/`<Repeat>`/memo) followed at the same level by a fragment containing no functions reset the flag, so `flatten` returned a plain array with the raw accessor still inside instead of the resolving wrapper. Every renderer crashed on the raw function: universal hosts received it in `insertNode` (as reported), and the DOM renderer threw `insertBefore … parameter 1 is not of type 'Node'` — the protective function branch remembered from 1.x dom-expressions does not exist in 2.0. Reported with the fix by @antoinevanwel; also submitted by @nickshiro.
