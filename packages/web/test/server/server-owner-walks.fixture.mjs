// The core's owner walks over SERVER owners, run by server-owner-walks.spec.tsx
// in a child Node against the BUILT artifacts under `--conditions`. Signals'
// observe and prod artifacts mangle `_` fields; `_parent` and `_name` are the
// reserved cross-package pair, so the core's `ownerPath` and
// `isExcluded` walks work on solid-js's SSR owners in every tier. Before the
// reservation, `ownerPath` needed a server-side shim and `OBSERVE.exclude` was
// a silent no-op for a server owner outside dev. Prints one JSON result.
import { Errored, createComponent, escape, renderToString, ssr } from "@solidjs/web";
import { OBSERVE, getOwner } from "solid-js";

const fallback = err => ssr(["<p>", "</p>"], escape(String(err().message)));

const errored = children =>
  createComponent(
    Errored,
    {
      fallback,
      get children() {
        return children();
      }
    },
    "Errored"
  );

/** A labelled component that throws inside an <Errored>, `exclude`-ing its root first if asked. */
const app = exclude => () =>
  createComponent(
    () => {
      if (exclude && OBSERVE) OBSERVE.exclude(getOwner());
      return errored(() => {
        throw new Error("boom");
      });
    },
    {},
    "App"
  );

async function findings(run) {
  const capture = OBSERVE ? OBSERVE.diagnostics.capture() : undefined;
  const html = await run();
  const events = capture ? capture.stop() : [];
  return { html, findings: events.map(e => ({ code: e.code, ownerPath: e.ownerPath })) };
}

const results = { observe: OBSERVE !== undefined };
results.plain = await findings(() => renderToString(app(false)));
results.excluded = await findings(() => renderToString(app(true)));
process.stdout.write(JSON.stringify(results));
