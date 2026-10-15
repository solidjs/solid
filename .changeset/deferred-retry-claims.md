---
"@solidjs/web": patch
---

A server component's hole that waits on async data keeps its handler-position markers (`_s:on:click`) when a boundary outside the component resumes it. The retry renders under the component's claims arming instead of the resuming boundary's context, so the markup the client adopts carries the marker. Before, the chat example's Copy buttons shipped without it and were only bound after the end-of-response sweep re-sent the whole message list.
