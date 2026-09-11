---
"@solidjs/web": patch
---

The flash cookie is now host-locked.

- The cookie is renamed to `__Host-flash`. Browsers refuse that name unless the cookie is `Secure`, `Path=/`, and has no `Domain`, so only the exact host can write it. Before, any sibling subdomain could plant a value in the slot. The planted value fails to decrypt, which reads as no flash, so a user could lose the confirmation for a mutation that already committed and retry it.
- `clearFlashCookie()` now meets the same rules, so the browser does not refuse the deletion.

Read the cookie name from the exported `FLASH_COOKIE` constant if you hard-coded `flash`. An outcome set by an older version is dropped rather than shown.
