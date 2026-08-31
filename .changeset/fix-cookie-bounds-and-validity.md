---
"@solidjs/web": patch
---

Two cookie fixes. The no-JS flash cookie now degrades instead of vanishing
when an outcome exceeds the browser's 4 KB cookie ceiling (#3137): past it
the whole Set-Cookie was silently discarded — no error anywhere, and the
page after the redirect looked like nothing was submitted, inviting the
retry that writes twice. The encoder drops the input echo first, then
bounds the value itself (a string keeps the longest prefix that fits,
structured results reduce to the outcome flag), and the submission arrives
with `truncated` set so integrations can say "succeeded, result too large
to display". And `serializeCookie` now refuses in dev the shapes every
browser silently rejects on arrival (#3138): `__Host-`/`__Secure-` prefix
requirements and `SameSite=None`/`Partitioned` without `Secure` — each one
attribute away from a cookie that never comes back, with login-shaped
consequences. The validation compiles out of production builds. CHIPS
`partitioned` is also supported now, so partitioned third-party cookies no
longer require hand-building the header string.
