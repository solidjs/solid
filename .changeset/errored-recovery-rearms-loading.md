---
"@solidjs/signals": patch
---

An `<Errored>` recovery re-arms its subtree: every `<Loading>` under an error fallback counts as not shown, so on recovery it catches what is still pending in the replacement frame and shows its fallback beside the recovered content, instead of the error staying up until the nested content is ready (#4627).
