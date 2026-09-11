---
"@solidjs/compiler": patch
---

Server-function ids now name a function by its binding path, so two same-named functions no longer share one id.

- `makeA`'s `submit` becomes `makeA.submit-<hash>` instead of `submit-<hash>`.
- Adding a same-named function no longer re-points the ids of the existing ones.
- Ids for functions in objects and classes pick up those names too, such as `handlers.save`.
- A named function contributes its own name as well, so `register(function saveHandler() {})` inside `wire` is `wire.saveHandler` rather than sharing an ordinal with its siblings.
