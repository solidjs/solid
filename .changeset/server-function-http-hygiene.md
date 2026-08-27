---
"@solidjs/web": patch
---

Harden the server function handler's HTTP layer. The method gate is now an allowlist: POST always dispatches, GET and HEAD dispatch only to `GET`-declared functions, and every other verb answers 405 — previously a HEAD (or PUT/DELETE/PATCH) request bypassed the GET gate entirely and executed any registered function with attacker-chosen query arguments (#3069). HEAD runs the function like GET and strips the body per spec. Responses now default to `Cache-Control: no-store` unless the function set its own cache policy, and GET/HEAD requests to `GET`-declared functions skip the CSRF origin gate so their responses no longer carry the `Vary: Sec-Fetch-Site, Origin, Referer` that fragmented shared-cache entries — declared reads are protected by same-origin policy, and caching becomes opt-in on the wire instead of just in prose (#3071).
