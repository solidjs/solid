---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"@solidjs/web": patch
---

Validate document-shell templates in the document context (#3259). The `validate` pass round-trips templates through a body-context fragment parse, which strips `<html>`/`<head>`/`<body>` wrappers no matter how well-formed the markup — so once #3099 made validate failures compile errors, a root component owning the document shell failed to compile in plain client mode, and merely importing it (the jsdom component-test configuration) was fatal. Shell-rooted templates now parse as a document and the shell element is compared back — the analogue of the synthetic `<table>` wrap for table partials, in both the Babel plugin and the native compiler. Genuine restructuring (an implied `<head>`, flow content in `<head>`, a `<p>` split in `<body>`) still errors. Since `<template>` parsing flattens shells, actually client-creating one now throws a descriptive dev-mode error from `template()` pointing at `hydrate()` — the failure moved from every import to the one broken act.
