---
"solid-js": patch
---

`<Errored>` escapes its children on the server (#4116). A boundary's content never passes a compiled `escape` hole, so `<Loading>` escapes it itself; `<Errored>` did not, and a string child (or an array of strings, or a function returning one) was written into the HTML raw — user text inside an error boundary became live markup, and the client's text node mismatched on hydrate.
