// The SSR wire-policy scenarios (#3468), run by ssr-error-sanitization.spec.tsx
// in a child Node against the BUILT artifacts — the workspace `solid-js` and
// the self-linked `@solidjs/web` — under whatever `--conditions` the spec
// passes, so the tier under test is the one Node's resolver picks: default
// (production), `observe`, `development`. No JSX: the compiled shapes are
// written out (`createComponent`, `ssr`, `escape`). Prints one JSON result.
import {
  Errored,
  Loading,
  createComponent,
  escape,
  isDev,
  markSafeError,
  renderToStream,
  renderToString,
  ssr
} from "@solidjs/web";
import { renderServerComponent } from "@solidjs/web/frames/server";
import { OBSERVE, createMemo } from "solid-js";

const delay = ms => new Promise(r => setTimeout(r, ms));

/** A driver error as one actually arrives: secrets in message and own-props. */
const databaseError = () =>
  Object.assign(new Error("connect ECONNREFUSED postgres://app:hunter2@10.0.0.5:5432"), {
    connectionString: "postgres://app:hunter2@10.0.0.5:5432",
    query: "SELECT * FROM users WHERE token = 'abc123'"
  });

/** The fallback every scenario renders: the message and one own property, as an app would. */
const fallback = err =>
  ssr(
    ['<p class="fallback">', "|", "</p>"],
    escape(String(err().message)),
    escape(String(err().query))
  );

// The compiled shapes, label included — `createComponent(Comp, props, "Comp")`
// is what the SSR compiler emits with `componentNames`, and what gives a
// finding its `ownerPath`.
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
const loading = (children, text = "loading") =>
  createComponent(
    Loading,
    {
      fallback: ssr([`<i>${text}</i>`]),
      get children() {
        return children();
      }
    },
    "Loading"
  );

function stream(code) {
  return new Promise(resolve => {
    const chunks = [];
    renderToStream(code).pipe({
      write(chunk) {
        chunks.push(String(chunk));
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

/** Findings recorded while `run` executes, as plain data. */
async function withFindings(run) {
  const capture = OBSERVE ? OBSERVE.diagnostics.capture() : undefined;
  const value = await run();
  const events = capture ? capture.stop() : [];
  return {
    value,
    findings: events.map(e => ({
      code: e.code,
      severity: e.severity,
      ownerPath: e.ownerPath,
      message: e.message,
      error: e.data && e.data.error !== undefined ? String(e.data.error) : undefined
    }))
  };
}

const results = { isDev, observe: OBSERVE !== undefined };

// 1. <Errored> catching a plain error in a sync render.
{
  const boom = databaseError();
  results.errored = await withFindings(() =>
    renderToString(() =>
      errored(() => {
        throw boom;
      })
    )
  );
}

// 2. markSafeError passes through with own properties.
results.safe = await withFindings(() =>
  renderToString(() =>
    errored(() => {
      throw markSafeError(Object.assign(new Error("Item not found"), { query: "item:42" }));
    })
  )
);

// 3. A rejected async source under <Loading> inside <Errored>: the boundary's
//    record, the source's serialized rejection, the fragment — one original.
{
  const boom = databaseError();
  results.channel = await withFindings(() =>
    stream(() =>
      errored(() =>
        loading(() => {
          const data = createMemo(async () => {
            await delay(5);
            throw boom;
          });
          return ssr(["<div>", "</div>"], escape(data()));
        })
      )
    )
  );
}

// 4. A <Loading> fragment that rejects, with nested pending work: the `_fr`
//    rejection is the client's; the abandonment ledger keeps the original.
{
  const boom = databaseError();
  results.fragment = await withFindings(() =>
    stream(() =>
      loading(() => {
        const failing = createMemo(async () => {
          await delay(5);
          throw boom;
        });
        // The #3165 shape: the discarded subtree holds a nested boundary
        // whose resume loop is parked forever — its release is the
        // abandonment. Created before the failing read so it exists to be
        // discarded.
        const nested = loading(() => {
          const stuck = createMemo(async () => new Promise(() => {}));
          return ssr(["<span>", "</span>"], escape(stuck()));
        }, "inner");
        return ssr(["<div>", "", "</div>"], escape(failing()), nested);
      }, "outer")
    )
  );
}

// 5. An Error reached as a VALUE is data, the author's — never thrown.
results.value = await withFindings(() =>
  renderToString(() => {
    const data = createMemo(() => ({ problem: new Error("field: name is required") }));
    return ssr(["<div>", "</div>"], escape(data().problem.message));
  })
);

// 6. Frame streams: a synchronous root failure's error chunk, and a failing
//    fragment's keyed chunks — the fragment's, and the live hole's: a thunk
//    hole (`() => escape(...)`, the compiled shape of a dynamic expression in
//    a server component) whose re-evaluation throws.
{
  const boom = databaseError();
  results.frameRoot = await withFindings(async () => {
    const chunks = await renderServerComponent(
      () => {
        throw boom;
      },
      { frame: { id: "f-err" } }
    );
    return chunks;
  });
  const boom2 = databaseError();
  results.frameFragment = await withFindings(async () => {
    const chunks = await renderServerComponent(
      () =>
        ssr(
          ["<section>", "</section>"],
          loading(() => {
            const data = createMemo(async () => {
              await delay(5);
              throw boom2;
            });
            return ssr(["<p>", "</p>"], () => escape(data()));
          })
        ),
      { frame: { id: "f-frag" } }
    );
    return chunks;
  });
}

process.stdout.write(JSON.stringify(results));
