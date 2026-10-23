---
"@solidjs/web": patch
"solid-js": patch
---

Live `For` rows whose markup kept its structure now travel as text and attribute edits that the client writes in place, instead of html it parses and morphs; any other change still ships the row whole. A dev server also ships a hash of each patched row's element tree, so a row the browser's parser restructured is reported and resynced instead of written. A live `<Repeat>`'s rows now take the same path; before, its hole was re-sent whole on every change.
