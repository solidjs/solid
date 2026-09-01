---
"@solidjs/web": patch
---

Trust only a conforming (digit-string) Content-Length in the bodySizeLimit guard: a negative declaration (`-1`) satisfied neither the over-limit check nor the undeclared-body buffer path and streamed the body into the decoder uncapped; non-conforming declarations now route through the bounded buffer (#3153)
