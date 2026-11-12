---
"@solidjs/signals": patch
---

`mapArray`'s small-move pass (a swap, a rotate or a few displaced rows in a plain `<For>`) records each aligned run once and checks displaced rows for duplicates with a native scan of the window, instead of building a `Set` and probing every aligned row. A swap on 1,000 rows goes from about 10 µs to about 4.5 µs, and bundles with `mapArray` are 97 bytes smaller minified. No behavior change.
