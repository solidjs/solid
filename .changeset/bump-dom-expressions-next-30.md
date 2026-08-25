---
"@solidjs/web": patch
---

Bump dom-expressions to 0.50.0-next.30. Picks up the hydration fix for streamed `<Loading>` fallbacks (#2936): a pending boundary's placeholder scaffolding (`<template id="pl-X">` and its `<!--pl-X-->` end comment) is now excluded from hydration claim arrays, so a reactive text hole in the fallback adopts the server-rendered node and updates replace it in place instead of appending debris.
