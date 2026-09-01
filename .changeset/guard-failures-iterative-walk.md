---
"@solidjs/web": patch
---

Fix a deep-but-legal server function result being reported as a failed call (#3160). `guardFailures` walked the result recursively, so ~10k+ nesting overflowed the stack and the `RangeError` escaped into dispatch's catch as a phantom function error — a successful, committed call answered with a generic 500. The container walk now carries an explicit stack (the `isJSONSafe` precedent), and any residual synchronous throw on the codec road is renamed to an encode error before rethrow so misattribution cannot recur from another cause.
