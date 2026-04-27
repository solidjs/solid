---
"solid-js": patch
---

Diagnostic messages now include their stable code identifier as a prefix (e.g. `[NO_OWNER_EFFECT] Effects created outside a reactive context will never be disposed`). Applied to all dev-mode diagnostics: `STRICT_READ_UNTRACKED`, `PENDING_ASYNC_UNTRACKED_READ`, `PENDING_ASYNC_FORBIDDEN_SCOPE`, `SIGNAL_WRITE_IN_OWNED_SCOPE`, `RUN_WITH_DISPOSED_OWNER`, `NO_OWNER_CLEANUP`, `CLEANUP_IN_FORBIDDEN_SCOPE`, `NO_OWNER_EFFECT`, `NO_OWNER_BOUNDARY`, `ASYNC_OUTSIDE_LOADING_BOUNDARY`, and `MISSING_EFFECT_FN`.

The previously bare `throw new Error("Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled")` (raised when creating a memo, effect, or owner inside `createTrackedEffect`/`onSettled`) is now also surfaced through the diagnostic system as `PRIMITIVE_IN_FORBIDDEN_SCOPE` (severity `error`, dev-only, throws after emitting). Existing tests that match the message substring continue to work.

The code identifier surfaces in console output and thrown errors, so users (and AI tools) can search documentation, issue trackers, and the source by code rather than parsing prose. The `code` field on `DiagnosticEvent` is unchanged — this only affects the human-readable `message` string.
