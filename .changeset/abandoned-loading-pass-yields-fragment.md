---
"solid-js": patch
---

A server `<Loading>` whose creating pass is disposed (an `<Errored>` retry re-rendering its children) now stops retrying instead of looping until "did not converge". A boundary re-created under the same fragment id owns the fragment, so the abandoned instance never settles it with blank markup; with no successor, the abandoned instance releases its fragment so the response still ends.
