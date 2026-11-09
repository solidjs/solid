---
"@solidjs/signals": patch
---

An `<Errored>` boundary no longer loops ("Potential Infinite Loop Detected") after a memo it caught is re-asked: a reader born in the flush that read a memo with a staged new error throws that error, not the committed one (D-41, #4404); a pass replacing an error the memo staged is a change even when it computes the committed value, so the `latest()` readers that threw the staged error re-derive (D-41, #4403); and at an action's landing an errored boundary tree re-derives, so it links the content the landing remounted and that content's recovery reaches it (D-3, D-39, #4405).
