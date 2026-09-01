---
"@solidjs/signals": minor
"solid-js": minor
---

Point-of-pain discovery for diagnostics: `DEV.diagnostics.setConsoleFooter(fn)` registers a footer printed once per diagnostic code after that code's first console report. solid-js registers a footer in dev pointing at its shipped repair skill (`node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`), so anyone — human or agent — hitting a diagnostic warning learns where the prescribed fix lives without prior knowledge of the skill system.
