---
"@solidjs/signals": patch
---

Probe (not for merge): a render effect born held and uncaught under a verdict lane's mount holds the lane until the parent's landing, so a display-ahead `Show` branch attaches with its content (S-46 plain row, #4417 content half). Measured over budget (+30 B minified on every lane scenario; three caps over, one a frozen floor) and unsound in the generator (the held verdict lane freezes every verdict reader of the transaction for the whole hold).
