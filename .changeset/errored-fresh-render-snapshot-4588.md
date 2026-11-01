---
"solid-js": patch
---

fix(solid): a hydrated `<Errored>` whose failure the server streamed recovers from a content-input write made before the fragment arrived. The fresh render after a rejected fragment adopts the server's answers by id, and now reads the server's snapshot as a claim does, so a node it creates holds the answer for the inputs the server rendered with and replays the client's write at release, re-asking with the new input; written after the fragment arrived, the write already re-asked (#4588)
