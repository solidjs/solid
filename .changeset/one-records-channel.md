---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/diagnostics": patch
---

One records channel: the attribution engine's records (`rerun`, `create`, `effect`, `flush`, `flight`, `fallback`, `interaction`, `hold`, `navigation`, `graph`) are `RecordTypes` entries delivered on `OBSERVE.records.subscribe(type, (event, live) => …)`, with the live node beside each record. Removed `attribution.subscribe` (both overloads), `OBSERVE.subjectOf`, the `AttributionRecords`/`AttributionRecordType` types, and the `isSilentHold`/`isLongHold` helpers — `HoldEvent` now carries `silent` and `long`, computed at settle. `attribution.history()`, `waterfalls()`, `holds()`, `navigations()` and `interactions()` collapse into `attribution.history(type)`. `DiagnosticListener` receives the subject as its second argument. The channel allocates nothing per emit (copy-on-write listener lists), and a `RerunEvent` is built only while a listener, a fold or the log wants it. Record listeners belong to the channel and are no longer dropped by `attribution.disable()`.
