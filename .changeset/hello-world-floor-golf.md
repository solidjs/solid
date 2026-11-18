---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Smaller client bundles: code only lanes, guesses and store projections use no longer ships in apps that import none of them, and a delegated root is read off its container's owners instead of a second counter (the compiled hello world drops 88 B brotli).
