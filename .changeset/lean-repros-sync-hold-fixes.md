---
"@solidjs/signals": patch
"solid-js": patch
---

Fix the reactivity bugs in Milo's `lean.test.ts` repros (21 of 25; the other four stay pinned as open questions or as rulings not built yet):

- Sync glitches: a stale CHECK no longer stops the next flush's marking (S0). A memo that reads its own child sees the updated value (S1). A queued child moves with its owner and no longer runs before the owner that disposes it (S3). Height adjustment no longer requeues an owner that reads its child (S2). A pass's owned write to a signal it just read is a missed wake (S4, F-10).
- A tick that nets back to its starting value (D-8) no longer asks async readers a new question. A pass that read only committed values asks the committed question again, which is a quiet re-ask (F-9, K1/K1b). `refresh()` no longer launders a held new question (K4).
- `latest()` keeps showing a held error, or a held first answer, while the next question is in flight (D-22, D-41; T2, K3).
- A write lands while an `<Errored>` shows its fallback over a pending read (F-3, F-12; E1).
- A hold's commit lands each async node on the answer to its own question, and a user effect waits for the end of the hold: a run owed for a superseded pass is dropped (F-1, F-2; T1).

Size offsets: `solid-js` exports `createRoot`, `createSignal` and `createRenderEffect` as live bindings that `enableHydration()` reassigns, instead of wrappers that spread their arguments into the hydrated or core function. A client-only app calls the core function directly.
