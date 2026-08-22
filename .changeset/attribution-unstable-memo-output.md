---
"@solidjs/signals": patch
---

Add the `UNSTABLE_MEMO_OUTPUT` dev attribution warning. A memo that commits a
referentially-new but shallowly-equivalent plain object or array on
consecutive runs (default 4) has an equality gate that never closes, so every
subscriber re-runs on every upstream change — the fan-out amplifier that was
previously only findable by profiling. Engine-side only: the check compares
the value snapshotted at `recomputeStart` against the committed value at
`recomputeEnd`, skips non-plain shapes (a fresh Promise per run is a genuinely
new value) and overlay runs, and warns once per streak. Configure or disable
via `DEV.attribution.enable({ unstableMemos })`.
