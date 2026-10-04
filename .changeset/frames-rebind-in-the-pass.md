---
"@solidjs/web": patch
---

Frames client: an address switch re-arms the shell gate and rebinds the frame in the pass that sees the new address (the follow's compute), not in an effect's run. Under the hold model a switch delivered while the previous switch's gate still pends lands the binding in the frame that gate holds, and an effect's run is stashed with that frame — behind the very gate the rebind would release, so a second switch mid-flight never bound to the live call. The gate signal takes `ownedWrite` (the re-arm and a warm rebind's release are written from the pass). Both the call-driven mount and the document-adoption face.
