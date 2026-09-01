---
"@solidjs/web": patch
---

A 2xx the client transport cannot recognize now fails the call instead of resolving as `undefined` (#3173, revisiting #3087). A captive portal, WAF interstitial, or misrouted SPA index answering 200 with HTML was indistinguishable from a void result; the transport now requires a success response to carry the runtime's body-format tag (stamped on every encoded response, void included) or the verbatim-passthrough marker, and rejects anything else with the status and content-type named. Genuine void results and raw passthroughs are unaffected; the header alone is judge, never the body.
