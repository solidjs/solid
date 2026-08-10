---
"@solidjs/signals": patch
---

Dev-mode error for untracked async reads after `await` (#2987)

A `NotReadyError` that rejects an async computation's flight is treated as
pending and retried through the settle sweep over the source's subscribers —
which requires the dependency edge a tracked read creates. A source FIRST
read after an `await` is untracked: no edge exists, the sweep can never find
the node, and it wedged forever — boundary hung on its fallback, `isPending`
reading false, no error anywhere.

Dev builds now detect the unreachable retry at rejection time (the source is
not among the node's deps, nor carried by any dep's pending chain) and
convert it to a descriptive error that propagates to `Errored`/logging.
Post-`await` re-reads of sources tracked before the first `await` keep their
retry behavior. The check is dev-only — it compiles out of production builds
entirely (all size gates unchanged), per the convention that authorship
diagnostics don't cost production bytes.
