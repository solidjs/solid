---
"@solidjs/web": patch
---

Experimental `broadcast(fn)`: a live server function whose answer is the same for every viewer. It implies `live` (and so `GET`); at the live address every caller with the same arguments shares one server render, and each viewer is a tap on it. A viewer that joins later gets the frame as it stands, then the shared batches; the render ends with its last viewer. The outer body still runs per call (auth, redirects), and the shared render runs under its own request event, so per-viewer state such as the router's query cache never reaches it.
