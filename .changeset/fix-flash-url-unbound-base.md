---
"@solidjs/web": patch
---

The no-JS flash cookie now records the UNBOUND function base as the submission's `url` — the request's pathname (`<endpoint>/<id>`), never the query. A `.with()`-bound form's action url carries its bound arguments in `?args=…`, and integrations match submissions against the action's unbound base (the router's `s.url === fn.base`): a flash url wearing the binding stored, decoded, and then matched nothing on the post-redirect render. The seed now matches the scripted submission shape exactly — the base as `url`, bound arguments prepended to `input` (which the argument parser's `?args` prepend already provided).
