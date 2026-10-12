---
"@solidjs/web": patch
---

`scriptNonce` and `styleNonce` are exported from the client entry and the public types, as one implementation both entries share. They only existed in the server build, so `import { scriptNonce } from "@solidjs/web"` failed to typecheck and broke client bundles. Both also accept `null`, matching the `CSPNonce | null` that `@solidjs/vite-plugin` declares for `event.nonce`.
