---
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

A bound `<select value>` marks its matching `<option selected>` while the server renders, not in a pass over the finished html (#4891). The old pass was switched on for the whole process by a module-scope `ssrSelectValues()` call in any module that had a bound select, so every render after it scanned its full html and every streamed fragment, even with no select in it. Both compilers now read the select's value once ahead of its children (`ssrSelect`) and keep it on a transparent owner the select's children render under (`ssrIn`). Each compiled server `<option>` asks `ssrOption` whether it is selected. Options a `<For>`, a component or a later async pass renders inside the select are matched too, and a select whose options stream in after a `<Loading>` inside it is no longer left unmarked. `ssrSelectValues` and `resolveSSRSelectValues` are removed. A multiple select's bound value is matched as the client assigns it, entry by entry from an array, with no comma split. An option whose text content is markup (no `value` attribute) is not matched.
