---
"@solidjs/web": patch
---

Navigation targets now carry an http(s) scheme floor on both legs of the redirect header (#3175). `maskRedirect` resolves targets with `new URL(target, requestUrl)` where an absolute scheme wins over the base, so `throw redirect(next)` with user data emitted `javascript:alert(document.cookie)` as the header's "resolved absolute target" — same-origin script execution in any integration that navigates to the decoded value. The transport now refuses non-http(s) schemes on `X-Server-Function-Redirect` and `Location` with a sanitized 500 (relative targets and cross-origin http(s) still flow — the same-origin-vs-allowlist policy is a separate, pending decision), and `decodeRedirectHeaderValue` enforces the resolved-absolute-http(s) contract it documents, so a hostile peer cannot re-open the class against `location.href = decoded.url` integrations.
