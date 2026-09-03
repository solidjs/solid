---
"@solidjs/web": patch
---

Refuse an unrecognized `X-Server-Function-Format` tag before the decode switch runs. The content-type sniffing branches (there for untagged form posts) matched regardless of the tag, so a body tagged with a format this build has no case for — version skew from a newer peer, or a duplicated header that `Headers.get` joins into one unknown value — was silently reinterpreted as a form and the function ran on an argument it was never sent. Such bodies now answer 400 before dispatch, with a development message naming version skew; untagged bodies keep the sniffing, and an untagged empty body stays a zero-argument call (#3214).
