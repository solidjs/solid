---
"solid-js": patch
"@solidjs/web": patch
---

Context barrier at server-component render roots. A server component renders inline in the document at t=0 but standalone on every refetch and mutation region, so an app-context read that resolved a provider at t=0 would silently break on the next response. `runInServerComponentScope` rebuilds the scope owner's context record so both renders agree by construction: user context is severed (default-less `useContext` throws an error explaining the boundary; defaulted contexts read their default), providers rendered inside the server component work normally, and boundary plumbing (`ErrorContext`, `RevealGroupContext`, `NoHydrateContext`) still crosses — Loading/Errored/reveal coordination between server-component content and enclosing boundaries is intentional. Client slot positions are unaffected: they re-enter the zone owner captured outside the barrier, keeping full app context during document SSR.
