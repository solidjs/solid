---
"@solidjs/web": patch
---

The flash cookie is now host-locked, and a falsy result is no longer read as no submission.

- The cookie is renamed to `__Host-flash`. Browsers refuse that name unless the cookie is `Secure`, `Path=/`, and has no `Domain`, so only the exact host can set it. Before, any sibling subdomain could set it and forge a successful submission outcome.
- `clearFlashCookie()` now meets the same rules, so the browser does not refuse the deletion.
- A call that returned `false`, `0`, `""`, or `null` used to decode as if nothing was submitted. It now decodes as the result it was.

Read the cookie name from the exported `FLASH_COOKIE` constant if you hard-coded `flash`. An outcome set by an older version is dropped rather than shown.
