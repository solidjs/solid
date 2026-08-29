---
"@solidjs/web": patch
---

live() reconnects through the 4xx statuses that say "retry" and honors Retry-After (#3100). The reconnect loop treated the whole 4xx band as a definite rejection, so a rate limiter's 429 — or a gateway's 408 — permanently closed a healthy stream. 408 (RFC 9110 §15.5.9), 425 (RFC 8470) and 429 (RFC 6585 §4) now reconnect like a 5xx, as does any failure whose response carries Retry-After — the peer inviting the retry in as many words. A named Retry-After wait (seconds or HTTP-date, stamped on the error as `retryAfter` in seconds for policy layers) replaces the exponential backoff guess for that attempt, capped at 60s so a misconfigured header cannot end the stream in all but name.
