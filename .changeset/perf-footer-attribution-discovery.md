---
"solid-js": patch
---

Dev console footer: perf/graph diagnostic codes now also point at the attribution surface (`DEV.attribution.enable()` — why-chains, `costs()`, `waterfalls()`) and the agent-loops skill. Breaks a discovery circularity: the sensitive perf detectors only fire while attribution is enabled, so the always-on graph warnings are the moment to teach that the deeper evidence channel exists.
