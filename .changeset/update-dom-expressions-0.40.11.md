---
"solid-js": patch
"babel-preset-solid": patch
---

Update DOM Expressions to 0.40.11 and seroval to 1.6.8. This picks up the seroval security fixes (CVE-2026-104846, CVE-2026-104845), streamed hydration roots keeping ownership of their container, SSR serialization of camelCase boolean properties like `readOnly`, releasing delegated events so Chromium doesn't retain detached DOM trees, universal renderer placeholder replacement, and raw-text `<style>`/`<script>` children in DOM templates.
