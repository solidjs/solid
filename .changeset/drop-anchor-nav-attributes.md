---
"@solidjs/web": patch
"@solidjs/h": patch
---

Remove `state`, `noscroll`, `replace`, and `preload` from core anchor JSX types. They are not standard `<a>` attributes; a routing integration declares them by augmenting `AnchorHTMLAttributes`. `link` stays — it is the shared explicit-links opt-in, and the SSR claim bag already copies that name. Media and webview `preload` attributes are unchanged. Types only.
