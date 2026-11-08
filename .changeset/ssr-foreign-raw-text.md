---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

SSR escapes the children of `<style>` and `<script>` under `<svg>` and `<math>`. There they are ordinary elements whose text parses as markup, so only HTML-namespace `<style>`/`<script>` render raw text (#4704).
