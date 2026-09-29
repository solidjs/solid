/**
 * @jsxImportSource @solidjs/web
 */
// Attribute slots (server-components-principles.md §9.2.3), server face: a slot
// call's return READ as an object — `const row = props.row(args)` — with
// its properties bound at positions of the server component's own markup:
//
//   <li class={{ completed: row.done }} hidden={row.removed}>
//     <input type="checkbox" checked={row.done} onInput={row.toggle} />
//
// Each read is a stand-in; the position it lands at emits a marker on the
// consuming element (`_s:<position>="<occurrence>:<key>[=<name>]"`), the
// client's contract for what it owns. The occurrence is the CALL (one data
// context), consumed by any number of elements. Stream face: markers and
// the occurrence's args record ship, the fill never runs, no values are
// written. Document face: the fill runs at t=0 and each position's value
// is written beside its marker.
//
// This suite compiles under the `serverComponents` compiler option (the
// server vitest config), which is what routes `ref`/`on*` and a dynamic
// `class`/`style` through runtime holes where the stand-in is seen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Loading, renderToStream } from "@solidjs/web";
import { createMemo, OBSERVE, sharedConfig, type DiagnosticEvent } from "solid-js";
import {
  frameTransformDirectResult,
  renderServerComponent,
  ServerComponentPlugin
} from "../../frames/src/frame-sink.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";

const collect = (stream: any): Promise<any[]> => stream;

// A server component's dynamic holes are live-addressed (`data-lha`, `lh:`
// comments — Stage 3); the attribute-slot contract is the rest of the markup.
const plain = (html: string) =>
  html.replace(/ data-lha="\d+"/g, "").replace(/<!--lh:\/?\d+-->/g, "");

function document(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin] } as any).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  capture = OBSERVE!.diagnostics.capture();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  capture.stop();
  warn.mockRestore();
});
const findings = (reason?: string) =>
  capture.events.filter(
    (e: DiagnosticEvent) =>
      e.code === "ATTRIBUTE_SLOT_POSITION" &&
      (reason === undefined || (e.data as any).reason === reason)
  );

const TODOS = [
  { id: "1", title: "a", completed: false },
  { id: "2", title: "b", completed: true }
];

// The shared row: the same component the client renders for an optimistic
// insert — its `row` is an attribute slot here (§9.2.3's acceptance shape).
function TodoRow(props: { todo: (typeof TODOS)[number]; row: any }) {
  const row = props.row({
    $key: props.todo.id,
    id: props.todo.id,
    completed: props.todo.completed
  });
  return (
    <li class={{ todo: true, completed: row.done, editing: row.editing }} hidden={row.removed}>
      <input type="checkbox" checked={row.done} onInput={row.toggle} ref={row.checkbox} />
      <label style={{ opacity: row.opacity }}>{props.todo.title}</label>
      <button class={row.buttonClass} onClick={row.remove} aria-busy={row.busy}>
        ×
      </button>
    </li>
  );
}

// The other acceptance shape: the CALL sits in the shared component's prop
// — `row={props.row({ $key, ... })}` — so a compiled getter re-evaluates it
// once per position the component binds.
function KeyedRow(props: { id: string; title: string; row: any }) {
  return (
    <li class={{ todo: true, done: props.row.done }} hidden={props.row.removed}>
      <input type="checkbox" checked={props.row.done} onInput={props.row.toggle} />
      <label>{props.title}</label>
      <button onClick={props.row.remove}>×</button>
    </li>
  );
}

describe("attribute slots — stream face", () => {
  it("a `$key`ed call in a component prop is ONE occurrence and ONE record however often the getter re-evaluates it", async () => {
    const ServerComp = (props: any) => (
      <ul>
        {TODOS.map(t => (
          <KeyedRow
            id={t.id}
            title={t.title}
            row={props.row({ $key: t.id, id: t.id, completed: t.completed })}
          />
        ))}
      </ul>
    );
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "ds0k" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain(
      '<li class="todo" _s:class="row#1:done=done" _s:hidden="row#1:removed"><input type="checkbox" _s:checked="row#1:done" _s:on:input="row#1:toggle"><label>a</label><button _s:on:click="row#1:remove">×</button></li>'
    );
    const slots = chunks.filter(c => c.type === "slot");
    expect(slots.map(c => c.key)).toEqual(["row#1", "row#2"]);
    expect(findings()).toEqual([]);
  });

  it("an un-keyed call in a component prop is ONE occurrence and ONE record too: structural identity of the args (`$key` is optional)", async () => {
    const ServerComp = (props: any) => (
      <ul>
        {TODOS.map(t => (
          <KeyedRow
            id={t.id}
            title={t.title}
            row={props.row({ id: t.id, completed: t.completed })}
          />
        ))}
      </ul>
    );
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "ds0u" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    // Positional ids, one per row: the getter's re-evaluations found the
    // first call registered as data and reused it.
    expect(html).toContain(
      '<li class="todo" _s:class="row#0:done=done" _s:hidden="row#0:removed"><input type="checkbox" _s:checked="row#0:done" _s:on:input="row#0:toggle"><label>a</label><button _s:on:click="row#0:remove">×</button></li>'
    );
    expect(html).toContain(
      '<li class="todo" _s:class="row#1:done=done" _s:hidden="row#1:removed">'
    );
    const slots = chunks.filter(c => c.type === "slot");
    expect(slots.map(c => c.key)).toEqual(["row#0", "row#1"]);
    expect(slots.map(c => c.args)).toEqual([
      { id: "1", completed: false },
      { id: "2", completed: true }
    ]);
    expect(findings()).toEqual([]);
  });

  it("two identical un-keyed MARKUP calls stay two ranges; args identity can't be read by value stays positional", async () => {
    const ServerComp = (props: any) => {
      // Placed twice with identical args: two occurrences, two ranges.
      // A call whose args hold a function (a thunk) is never compared.
      const a = props.thing({ kind: "x", body: () => "server content" });
      const b = props.thing({ kind: "x", body: () => "server content" });
      return (
        <div>
          <props.badge kind="new" />
          <props.badge kind="new" />
          <span data-a={a.value} data-b={b.value} />
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "ds0m" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain("<!--slot:badge#0:start--><!--slot:badge#0:end-->");
    expect(html).toContain("<!--slot:badge#1:start--><!--slot:badge#1:end-->");
    expect(html).toContain('<span _s:data-a="thing#0:value" _s:data-b="thing#1:value">');
    const slots = chunks.filter(c => c.type === "slot");
    expect(slots.map(c => c.key)).toEqual(["thing#0", "thing#1", "badge#0", "badge#1"]);
  });

  it("emits one marker per bound position on each consuming element and the occurrence's args record; no values, no range markers", async () => {
    const ServerComp = (props: any) => (
      <ul>
        {TODOS.map(t => (
          <TodoRow todo={t} row={props.row} />
        ))}
      </ul>
    );
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "ds0" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    // The static class name stays inline; the slot-bound names ride the
    // marker only (the stream face writes no values).
    expect(html).toContain(
      '<li class="todo" _s:class="row#1:done=completed,row#1:editing=editing" _s:hidden="row#1:removed">'
    );
    expect(html).toContain(
      '<li class="todo" _s:class="row#2:done=completed,row#2:editing=editing" _s:hidden="row#2:removed">'
    );
    expect(html).toContain(
      '<input type="checkbox" _s:checked="row#1:done" _s:on:input="row#1:toggle" _s:ref="row#1:checkbox">'
    );
    expect(html).toContain('<label _s:style="row#1:opacity=opacity">a</label>');
    expect(html).toContain(
      '<button _s:class="row#1:buttonClass" _s:aria-busy="row#1:busy" _s:on:click="row#1:remove">×</button>'
    );
    expect(html).not.toContain("<!--slot:row");
    expect(html).not.toContain("checked ");
    expect(html).not.toContain("hidden ");
    // The same record a markup slot's call emits — one per occurrence (the
    // call), not per consuming element.
    const slots = chunks.filter(c => c.type === "slot");
    expect(slots.map(c => c.key)).toEqual(["row#1", "row#2"]);
    expect(slots[0].args).toEqual({ id: "1", completed: false });
    expect(slots[1].args).toEqual({ id: "2", completed: true });
    expect(findings()).toEqual([]);
  });

  it("a zero-arg call is one occurrence named by the prop, consumed by every element that reads it", async () => {
    const ServerComp = (props: any) => {
      const block = props.codeBlock();
      return (
        <div>
          <button onClick={block.copy}>Copy</button>
          <button onClick={block.copy} ref={block.el}>
            Copy too
          </button>
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "ds1" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain('<button _s:on:click="codeBlock:copy">Copy</button>');
    expect(html).toContain(
      '<button _s:on:click="codeBlock:copy" _s:ref="codeBlock:el">Copy too</button>'
    );
  });

  it("keys and class names percent-encode onto the marker alphabet", async () => {
    const ServerComp = (props: any) => {
      const row = props.row({ id: 1 });
      return <li class={{ "is-done,really": row["a:b=c"] }} data-x={row["k,v"]} />;
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "ds2" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain('_s:class="row#0:a%3Ab%3Dc=is-done%2Creally"');
    expect(html).toContain('_s:data-x="row#0:k%2Cv"');
  });

  it("a runtime spread binds the same way; spreading the slot's return itself is an error", async () => {
    const Spread = (props: any) => {
      const row = props.row({ id: 1 });
      return <li {...{ class: { done: row.done }, hidden: row.removed, onClick: row.pick }} />;
    };
    const chunks = await collect(renderServerComponent(Spread, { frame: { id: "ds3" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain(
      '<li _s:class="row#0:done=done" _s:hidden="row#0:removed" _s:on:click="row#0:pick">'
    );

    const Whole = (props: any) => <li {...props.row({ id: 1 })} />;
    const failed = await collect(renderServerComponent(Whole, { frame: { id: "ds4" } }));
    const error = failed.find(c => c.type === "error");
    expect(error).toBeDefined();
    expect(findings("spread").length).toBe(1);
  });

  it("a `prop:*` key of a runtime spread bound to a stand-in is a dev finding; handler names derive as the client's `on*` does", async () => {
    const Spread = (props: any) => {
      const row = props.row({ id: 1 });
      return <li {...{ onMyEvent: row.g, "prop:value": row.v }} />;
    };
    const chunks = await collect(renderServerComponent(Spread, { frame: { id: "ds6" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain('<li _s:on:myevent="row#0:g">');
    expect(findings("prop").map(e => (e.data as any).position)).toEqual(["prop:value"]);
    expect(findings()).toHaveLength(1);
  });

  it("named `ref`/`on*` on a compiled spread element bind through the claim map: every shape the template path binds", async () => {
    // A spread element compiles its named `ref`/`on*` to the same claim map
    // a template element's `ssrClaim` hole reads, handed to `ssrElement` as
    // a thunk it reads only inside a server component's render. So the
    // shapes are the template path's: a handler before, between or after
    // the spreads; an array ref; duplicate refs merged; a handler tuple; a
    // named ref joining the spread's own; a named handler after the spread
    // over the spread's own (source order — see the next spec); a
    // server-local function raising `server-local`. Statics after the last
    // spread still bake into the tail; the markers follow the sources'
    // attributes.
    const local = () => {};
    const Spread = (props: any) => {
      const row = props.row({ id: 1 });
      const rest = { "data-k": "v", onInput: row.type, ref: row.spreadRef, onClick: row.lose };
      return (
        <button {...rest} onClick={row.go} ref={row.el} class="static">
          <span
            onInput={row.before}
            {...{ title: "t" }}
            onKeyDown={[row.key, 1]}
            {...{ "data-z": 1 }}
          />
          {/* @ts-expect-error TS17001 — duplicate `ref` is JS-valid; the compilers merge them */}
          <i ref={[row.a, row.b]} ref={row.c} {...{ id: "i" }} onClick={local} />
        </button>
      );
    };
    const chunks = await collect(renderServerComponent(Spread, { frame: { id: "ds6s" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain(
      '<button data-k="v" _s:on:input="row#0:type" _s:ref="row#0:spreadRef,row#0:el" _s:on:click="row#0:go" class="static">'
    );
    expect(html).toContain(
      '<span title="t" data-z="1" _s:on:input="row#0:before" _s:on:keydown="row#0:key">'
    );
    expect(html).toContain('<i id="i" _s:ref="row#0:a,row#0:b,row#0:c">');
    expect(html).not.toContain("row#0:lose");
    expect(findings("server-local").map(e => (e.data as any).position)).toEqual(["click"]);
    expect(findings()).toHaveLength(1);
  });

  it("a handler position on a compiled spread element settles in source order, as the client's mergeProps does", async () => {
    // The marker is a promise about what the client binds, and the client
    // compiles the same element to `spread(el, mergeProps(a, { onClick }, b))`
    // — the LAST source that has the key wins, a named attribute being a
    // source at its position. So a spread after a named handler owns the
    // position; a spread between two attributes loses to the later one and
    // beats the earlier; a spread that lacks the key (or carries `undefined`,
    // which `mergeProps` reads as "not set") leaves the named handler in
    // place; a duplicate named handler keeps the last only (the template
    // path's strip); a spread's server-local function owns the position and
    // binds nothing (with its finding). The sources may be plain literals or
    // — a spread CALL, thunked by the compiler — collected through the
    // owners pass; both paths carry the source index.
    const local = () => {};
    const Prec = (props: any) => {
      const row = props.row({ id: 1 });
      const withClick = { title: "w", onClick: row.spread };
      const b = { onClick: row.b };
      const plain = { "data-p": "1" };
      const pick = () => b;
      // TypeScript reads the same order (TS2783: a later spread with the key
      // overwrites the named attribute), hence the expect-errors.
      return (
        <div>
          {/* @ts-expect-error TS2783 */}
          <button onClick={row.go} {...withClick} />
          {/* @ts-expect-error TS2783 */}
          <a {...plain} onClick={row.go} {...b} />
          <i {...plain} onClick={row.go} {...plain} />
          {/* @ts-expect-error TS17001 — a duplicate handler keeps the last, as the template path does */}
          <b {...plain} onClick={row.first} onClick={row.second} />
          {/* @ts-expect-error TS2783 */}
          <u onClick={row.go} {...{ onClick: local }} />
          {/* @ts-expect-error TS2783 */}
          <s onClick={row.go} {...{ onClick: undefined }} />
          {/* @ts-expect-error TS2783 */}
          <em {...plain} onClick={row.go} {...pick()} />
          <q {...pick()} onClick={row.go} />
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(Prec, { frame: { id: "ds6p" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain('<button title="w" _s:on:click="row#0:spread">');
    expect(html).toContain('<a data-p="1" _s:on:click="row#0:b">');
    expect(html).toContain('<i data-p="1" _s:on:click="row#0:go">');
    expect(html).toContain('<b data-p="1" _s:on:click="row#0:second">');
    expect(html).toContain("<u></u>");
    expect(html).toContain('<s _s:on:click="row#0:go">');
    expect(html).toContain('<em data-p="1" _s:on:click="row#0:b">');
    expect(html).toContain('<q _s:on:click="row#0:go">');
    expect(html).not.toContain("row#0:first");
    expect(findings("server-local").map(e => (e.data as any).position)).toEqual(["click"]);
    expect(findings()).toHaveLength(1);
  });

  it("a compiled spread element's handler expressions never evaluate outside a server component", async () => {
    // The spec suite compiles with `serverComponents: true`, as a whole SSR
    // build does. A page element with a spread is still plain SSR: the claim
    // thunk is read only under an armed render context, so a handler
    // expression there is as unevaluated as the template path's guarded
    // hole leaves it.
    let evaluated = 0;
    const handler = () => {
      evaluated++;
      return () => {};
    };
    const Page = () => (
      <div>
        <button {...{ "data-k": "v" }} onClick={handler()} ref={handler()}>
          x
        </button>
        <a onClick={handler()} href="/">
          y
        </a>
      </div>
    );
    const html = await document(() => <Page />);
    expect(html).toContain('<button data-k="v">x</button>');
    expect(html).toContain('<a href="/">y</a>');
    expect(evaluated).toBe(0);
  });

  it("a handler position inside a live hole carries its marker on every re-emission, with an unrelated render interleaved", async () => {
    // The chat example's `codeBlock` shape: a zero-arg attribute slot read at an
    // event position INSIDE a live hole (an async-iterable-fed memo). The
    // consumer is absent from the hole's first states and appears only when
    // the text grows a code block; each sweep re-evaluates the template
    // under the mint-time render context, so the marker must ride every
    // re-emission — including sweeps that fire while another render owns
    // the module-global `sharedConfig.context` (a concurrent request).
    const words = ["hello", "world", "```", "code", "```"];
    const queue: string[] = [];
    // `null as …`: the declared union survives control-flow narrowing, which a
    // typed `= null` initializer would pin to `null` at the call sites below.
    let notify = null as (() => void) | null;
    let done = false;
    const text: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (queue.length === 0) {
              if (done) return { value: undefined as any, done: true };
              await new Promise<void>(r => (notify = r));
            }
            return { value: queue.shift()!, done: false };
          }
        };
      }
    };
    const Message = (props: { text: AsyncIterable<string>; block: any }) => {
      const t = createMemo(() => props.text);
      return (
        <Loading fallback={<p>▍</p>}>
          <div class="md">
            {t()
              .split("```")
              .map((seg, i) =>
                i % 2 ? (
                  <div class="code-block">
                    <button type="button" onClick={props.block.copy}>
                      Copy
                    </button>
                    <pre>{seg}</pre>
                  </div>
                ) : (
                  <p>{seg}</p>
                )
              )}
          </div>
        </Loading>
      );
    };
    const ServerComp = (props: any) => {
      const block = props.codeBlock();
      return (
        <section>
          <Message text={text} block={block} />
        </section>
      );
    };
    const streaming = collect(renderServerComponent(ServerComp, { frame: { id: "ds7" } }));
    let acc = "";
    for (const w of words) {
      await new Promise(r => setTimeout(r, 5));
      acc += (acc ? " " : "") + w;
      queue.push(acc);
      notify?.();
      notify = null;
      // Another request renders in between: plain SSR that never arms
      // claims, replacing the module-global context while sweeps fire.
      await document(() => <p onClick={() => {}}>other</p>);
    }
    done = true;
    notify?.();
    const chunks = await streaming;
    const emissions = chunks
      .filter(c => (c.type === "fragment" || c.type === "hole") && /Copy/.test(c.html))
      .map(c => plain(c.html));
    // The button rode at least one hole RE-EMISSION (a sweep), not only the
    // fragment's first splice.
    expect(chunks.some(c => c.type === "hole" && /Copy/.test(c.html))).toBe(true);
    for (const html of emissions) {
      expect(html).toContain('<button type="button" _s:on:click="codeBlock:copy">Copy</button>');
    }
    expect(findings()).toEqual([]);
  });

  it("a stand-in passed as another slot's ARG is a dev finding; the record carries `undefined` for it", async () => {
    const ServerComp = (props: any) => {
      const parent = props.parent({ id: "p1" });
      const child = props.child({ parentId: parent.id, own: "x" });
      return (
        <div class={parent.cls}>
          <span class={child.cls} />
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "dsa" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    expect(html).toContain(
      '<div _s:class="parent#0:cls"><span _s:class="child#0:cls"></span></div>'
    );
    const slots = chunks.filter(c => c.type === "slot");
    expect(slots.map(c => c.key)).toEqual(["parent#0", "child#0"]);
    expect(slots[0].args).toEqual({ id: "p1" });
    expect(slots[1].args.own).toBe("x");
    const table = createJSONDataTable();
    for (const c of chunks.filter(x => x.type === "data")) table.apply(c);
    expect(table.resolve(slots[1].args.parentId)).toBeUndefined();
    expect(findings("arg").map(e => e.data as any)).toEqual([
      { reason: "arg", occurrence: "child#0", key: "parentId", from: "parent#0", fromKey: "id" }
    ]);
    expect(findings()).toHaveLength(1);
  });

  it("stand-ins NESTED in a slot's arg are `undefined` at their path on both faces, each a dev finding; the t=0 fill reads what hydration will", async () => {
    // `{ nested: { x: parent.done } }` and `[parent.done]`: the stand-in used
    // to serialize as its own shape (`{ k, v, f }` — on the document face
    // with the t=0 value in `v`) with no finding, and the document face's
    // fill saw the live stand-in while hydration saw the record.
    const ServerComp = (props: any) => {
      const parent = props.parent({ id: "p1" });
      const child = props.child({
        nested: { x: parent.done, keep: 1 },
        list: [parent.done, "b"],
        own: "x"
      });
      return (
        <div class={parent.cls}>
          <span class={child.cls} />
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "dsan" } }));
    const slots = chunks.filter(c => c.type === "slot");
    const table = createJSONDataTable();
    for (const c of chunks.filter(x => x.type === "data")) table.apply(c);
    const args = slots[1].args;
    expect(args.own).toBe("x");
    const nested = table.resolve(args.nested) as any;
    expect(nested).toEqual({ x: undefined, keep: 1 });
    expect("x" in nested).toBe(true);
    expect(table.resolve(args.list)).toEqual([undefined, "b"]);
    expect(findings("arg").map(e => e.data as any)).toEqual([
      {
        reason: "arg",
        occurrence: "child#0",
        key: "nested",
        path: ".x",
        from: "parent#0",
        fromKey: "done"
      },
      {
        reason: "arg",
        occurrence: "child#0",
        key: "list",
        path: "[0]",
        from: "parent#0",
        fromKey: "done"
      }
    ]);
    expect(findings()).toHaveLength(2);

    // Document face: the fill's arg at t=0 is the record's arg.
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsand" }) as any;
    const seen: any[] = [];
    const html = plain(
      await document(() =>
        Inline({
          parent: () => ({ done: true, cls: "p" }),
          child: (p: any) => {
            seen.push(p);
            return {
              cls: p.nested.x === undefined && p.list[0] === undefined ? "scrubbed" : "leaked"
            };
          }
        })
      )
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].nested).toEqual({ x: undefined, keep: 1 });
    expect(seen[0].list).toEqual([undefined, "b"]);
    expect(html).toContain('<span class="scrubbed" _s:class="child#0:cls">');
    // One finding per (arg, path) for this render — the fill's arg and the
    // record are one scrub, not two — on top of the stream render's two.
    expect(
      findings("arg")
        .slice(2)
        .map(e => (e.data as any).path)
    ).toEqual([".x", "[0]"]);
    expect(findings()).toHaveLength(4);
  });

  it("a cyclic slot arg crosses the border as a cycle; a shared acyclic subtree is scrubbed at every occurrence, reported once", async () => {
    // Both walks (`withoutStandIns`, `toBorderForm`) used to recurse without
    // a guard — a self-referencing arg overflowed the stack on both faces.
    const ServerComp = (props: any) => {
      const parent = props.parent({ id: "p1" });
      const meta: any = { tag: "m", x: parent.done };
      meta.self = meta;
      const shared = { y: parent.done, keep: 2 };
      const child = props.child({ meta, pair: [shared, shared], own: "x" });
      return (
        <div class={parent.cls}>
          <span class={child.cls} />
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "dscy" } }));
    expect(chunks.find(c => c.type === "error")).toBeUndefined();
    const slots = chunks.filter(c => c.type === "slot");
    const table = createJSONDataTable();
    for (const c of chunks.filter(x => x.type === "data")) table.apply(c);
    const args = slots[1].args;
    const meta = table.resolve(args.meta) as any;
    expect(meta.tag).toBe("m");
    expect(meta.self).toBe(meta);
    // The stand-in at `meta.x` is scrubbed on the copy the record ships …
    expect("x" in meta).toBe(true);
    expect(meta.x).toBeUndefined();
    const pair = table.resolve(args.pair) as any[];
    expect(pair).toEqual([
      { y: undefined, keep: 2 },
      { y: undefined, keep: 2 }
    ]);
    // One finding per stand-in: the second occurrence of `shared.y` answers
    // from the walk's record of the first (see rewriteTree).
    expect(findings("arg").map(e => (e.data as any).path)).toEqual([".x", "[0].y"]);

    // … and the document face's t=0 fill sees the same cycle and scrub.
    const Inline = frameTransformDirectResult(ServerComp, { id: "dscyd" }) as any;
    const seen: any[] = [];
    const html = plain(
      await document(() =>
        Inline({
          parent: () => ({ done: true, cls: "p" }),
          child: (p: any) => {
            seen.push(p);
            return { cls: p.meta.self === p.meta && p.meta.x === undefined ? "cyclic" : "flat" };
          }
        })
      )
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].pair[0]).toEqual({ y: undefined, keep: 2 });
    expect(html).toContain('<span class="cyclic" _s:class="child#0:cls">');
  });

  it("a server-local function at a ref/on* position is a dev finding; a stand-in in a template string is another", async () => {
    const ServerComp = (props: any) => {
      const row = props.row({ id: 1 });
      return (
        <li class={`todo ${row.done}`} onClick={() => {}}>
          x
        </li>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "ds5" } }));
    const html = plain(chunks.find(c => c.type === "html").html);
    // The stringified stand-in contributes nothing on the stream face and
    // emits no marker: the client cannot own a fragment of a string.
    expect(html).toContain('<li class="todo ">x</li>');
    expect(findings("stringified").length).toBe(1);
    expect(findings("server-local").length).toBe(1);
  });
});

describe("attribute slots — document face (t=0)", () => {
  it("runs the fill at t=0 and writes each position's value beside its marker", async () => {
    const ServerComp = (props: any) => (
      <ul>
        {TODOS.map(t => (
          <TodoRow todo={t} row={props.row} />
        ))}
      </ul>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd0" }) as any;
    const refs: string[] = [];
    const html = plain(
      await document(() =>
        Inline({
          row: (p: any) => ({
            done: p.completed,
            editing: false,
            removed: p.id === "2",
            opacity: p.completed ? 0.5 : undefined,
            buttonClass: p.completed ? "destroy done" : "destroy",
            busy: p.id === "2",
            toggle: () => {},
            remove: () => {},
            checkbox: (el: any) => refs.push(String(el))
          })
        })
      )
    );
    expect(html).toContain(
      '<li class="todo" _s:class="row#1:done=completed,row#1:editing=editing" _s:hidden="row#1:removed">'
    );
    expect(html).toContain(
      '<li class="todo completed" _s:class="row#2:done=completed,row#2:editing=editing" hidden _s:hidden="row#2:removed">'
    );
    expect(html).toContain(
      '<input type="checkbox" _s:checked="row#1:done" _s:on:input="row#1:toggle" _s:ref="row#1:checkbox">'
    );
    expect(html).toContain(
      '<input type="checkbox" checked _s:checked="row#2:done" _s:on:input="row#2:toggle" _s:ref="row#2:checkbox">'
    );
    expect(html).toContain('<label _s:style="row#1:opacity=opacity">a</label>');
    expect(html).toContain('<label style="opacity:0.5" _s:style="row#2:opacity=opacity">b</label>');
    expect(html).toContain(
      '<button class="destroy" _s:class="row#1:buttonClass" _s:aria-busy="row#1:busy" _s:on:click="row#1:remove">×</button>'
    );
    expect(html).toContain(
      '<button class="destroy done" _s:class="row#2:buttonClass" aria-busy _s:aria-busy="row#2:busy" _s:on:click="row#2:remove">×</button>'
    );
    // Handlers and refs never serialize or run on the server.
    expect(html).not.toContain("toggle:");
    expect(refs).toEqual([]);
    // The occurrence's t=0 record, keyed for the adopting frame's store.
    expect(html).toContain("sc:slot:dsd0:row#1");
    expect(html).toContain("sc:slot:dsd0:row#2");
    expect(findings()).toEqual([]);
  });

  it("a `$key`ed call in a component prop runs the fill ONCE and emits ONE record at t=0", async () => {
    const ServerComp = (props: any) => (
      <ul>
        {TODOS.map(t => (
          <KeyedRow
            id={t.id}
            title={t.title}
            row={props.row({ $key: t.id, id: t.id, completed: t.completed })}
          />
        ))}
      </ul>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd0k" }) as any;
    const fill = vi.fn((p: any) => ({
      done: p.completed,
      removed: false,
      toggle: () => {},
      remove: () => {}
    }));
    const html = plain(await document(() => Inline({ row: fill })));
    expect(fill).toHaveBeenCalledTimes(2);
    expect(html).toContain(
      '<li class="todo done" _s:class="row#2:done=done" _s:hidden="row#2:removed"><input type="checkbox" checked _s:checked="row#2:done" _s:on:input="row#2:toggle"><label>b</label><button _s:on:click="row#2:remove">×</button></li>'
    );
    expect(html.match(/sc:slot:dsd0k:row#1"/g)).toHaveLength(1);
    expect(html.match(/sc:slot:dsd0k:row#2"/g)).toHaveLength(1);
    expect(findings()).toEqual([]);
  });

  it("an un-keyed call in a component prop runs the fill ONCE and emits ONE record at t=0; identical markup placements stay two", async () => {
    const ServerComp = (props: any) => (
      <ul>
        {TODOS.map(t => (
          <KeyedRow
            id={t.id}
            title={t.title}
            row={props.row({ id: t.id, completed: t.completed })}
          />
        ))}
        <props.badge kind="new" />
        <props.badge kind="new" />
      </ul>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd0u" }) as any;
    const fill = vi.fn((p: any) => ({
      done: p.completed,
      removed: false,
      toggle: () => {},
      remove: () => {}
    }));
    const badge = vi.fn(() => <b>new</b>);
    const html = plain(await document(() => Inline({ row: fill, badge })));
    expect(fill).toHaveBeenCalledTimes(2);
    expect(badge).toHaveBeenCalledTimes(2);
    expect(html).toContain(
      '<li class="todo done" _s:class="row#1:done=done" _s:hidden="row#1:removed"><input type="checkbox" checked _s:checked="row#1:done" _s:on:input="row#1:toggle"><label>b</label><button _s:on:click="row#1:remove">×</button></li>'
    );
    expect(html.match(/sc:slot:dsd0u:row#0"/g)).toHaveLength(1);
    expect(html.match(/sc:slot:dsd0u:row#1"/g)).toHaveLength(1);
    expect(html).toMatch(/<!--slot:badge#0:start--><b[^>]*>new<\/b><!--slot:badge#0:end-->/);
    expect(html).toMatch(/<!--slot:badge#1:start--><b[^>]*>new<\/b><!--slot:badge#1:end-->/);
    expect(findings()).toEqual([]);
  });

  it("a zero-arg call in a component prop runs the fill ONCE at t=0; zero-arg markup placements stay two", async () => {
    const Block = (props: { block: any }) => (
      <div>
        <button onClick={props.block.copy} class={props.block.cls}>
          Copy
        </button>
        <button onClick={props.block.copy} ref={props.block.el}>
          Copy too
        </button>
      </div>
    );
    const ServerComp = (props: any) => (
      <section>
        <Block block={props.codeBlock()} />
        {props.note()}
        {props.note()}
      </section>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd0z" }) as any;
    const fill = vi.fn(() => ({ copy: () => {}, cls: "c", el: () => {} }));
    const note = vi.fn(() => <b>new</b>);
    const html = plain(await document(() => Inline({ codeBlock: fill, note })));
    expect(fill).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledTimes(2);
    expect(html).toContain(
      '<button class="c" _s:class="codeBlock:cls" _s:on:click="codeBlock:copy">Copy</button><button _s:on:click="codeBlock:copy" _s:ref="codeBlock:el">Copy too</button>'
    );
    expect(html.match(/<!--slot:note:start--><b[^>]*>new<\/b><!--slot:note:end-->/g)).toHaveLength(
      2
    );
    expect(findings()).toEqual([]);
  });

  it("the document face arms `claims` on the component's own render context: the page after it keeps the pre-slot walk, a late hole inside stays armed", async () => {
    // `claims` used to be set on the PAGE's context and never cleared, so
    // every spread element the document rendered after a server component
    // took the slot-aware walk. It now lives on a context derived from the
    // page's for the component's subtree — and a hole that resolves after
    // the component returned (a Loading boundary's async content) re-emits
    // under that mint-time context, so its handler marker still renders.
    const seen: any[] = [];
    const Probe = () => {
      seen.push(sharedConfig.context && (sharedConfig.context as any).claims);
      return null;
    };
    const Late = (props: { block: any }) => {
      const t = createMemo(() => new Promise<string>(r => setTimeout(() => r("Copy"), 5)));
      return (
        <button type="button" onClick={props.block.copy}>
          {t()}
        </button>
      );
    };
    const ServerComp = (props: any) => {
      const block = props.codeBlock();
      return (
        <Loading fallback={<p>...</p>}>
          <Late block={block} />
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dscl" }) as any;
    const html = plain(
      await document(() => [
        <Probe />,
        Inline({ codeBlock: () => ({ copy: () => {} }) }),
        <Probe />,
        <div {...{ class: { a: true } }} onClick={() => {}} />
      ])
    );
    expect(seen).toEqual([undefined, undefined]);
    expect(html).toContain('<button type="button" _s:on:click="codeBlock:copy">Copy</button>');
    expect(html).toMatch(/<div _hk=\d+ class="a"><\/div>/);
    expect(findings()).toEqual([]);
  });

  it("a fill that returned markup is read as data at a position: a dev finding, nothing written", async () => {
    const ServerComp = (props: any) => {
      const row = props.row({ id: 1 });
      return <li hidden={row.removed}>x</li>;
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd1" }) as any;
    const html = plain(await document(() => Inline({ row: () => <b>content</b> })));
    expect(html).toContain('<li _s:hidden="row#0:removed">x</li>');
    expect(findings("markup").length).toBe(1);
  });

  it("fill keys that shadow prototype methods (`filter`, `at`, `sort`, `map`, `join`) bind as data on both faces", async () => {
    // The document-face proxy's target is the range ARRAY and the stream
    // face's a plain object: a key present on either prototype must still
    // read as a slot value, never fall through to the prototype (which on
    // the document face wrote `data-f="function filter() { [native code] }"`
    // with no marker, and `hidden={row.at}` hid the element).
    const ServerComp = (props: any) => {
      const row = props.row({ id: 1 });
      return (
        <li data-f={row.filter} hidden={row.at} data-s={row.sort} class={{ m: row.map }}>
          <b data-j={row.join}>x</b>
        </li>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd2p" }) as any;
    const html = plain(
      await document(() =>
        Inline({ row: () => ({ filter: "f", at: false, sort: "s", map: true, join: "j" }) })
      )
    );
    expect(html).toContain(
      '<li data-f="f" _s:data-f="row#0:filter" _s:hidden="row#0:at" data-s="s" _s:data-s="row#0:sort" class="m" _s:class="row#0:map=m">'
    );
    expect(html).toContain('<b data-j="j" _s:data-j="row#0:join">x</b>');
    expect(html).not.toContain("native code");
    expect(findings()).toEqual([]);

    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "ds2p" } }));
    const stream = plain(chunks.find(c => c.type === "html").html);
    expect(stream).toContain(
      '<li _s:data-f="row#0:filter" _s:hidden="row#0:at" _s:data-s="row#0:sort" _s:class="row#0:map=m"><b _s:data-j="row#0:join">x</b></li>'
    );
    expect(findings()).toEqual([]);
  });

  it("a placed document-face range with a dynamic node survives the resolver's copy", async () => {
    // `escape` copies a node array with `.slice()` when it cannot join it
    // (a function node forces the copy). The document-face range is a
    // proxy over that array: `slice` must reach Array.prototype, not be
    // answered as a fill key — with the explicit passthrough set it was,
    // and every dynamic placement threw `s.slice is not a function`.
    const ServerComp = (props: any) => <section>{props.note()}</section>;
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd0d" }) as any;
    const html = plain(
      await document(() =>
        Inline({
          note: () => {
            const t = createMemo(() => "late");
            return <b>{t()}</b>;
          }
        })
      )
    );
    expect(html).toMatch(/<!--slot:note:start--><b[^>]*>late<\/b><!--slot:note:end-->/);
    expect(findings()).toEqual([]);
  });

  it("a fill output key the range's own shape occupies is a dev finding", async () => {
    const ServerComp = (props: any) => {
      const row = props.row({ id: 1 });
      return <li hidden={row.removed}>x</li>;
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd2" }) as any;
    await document(() => Inline({ row: () => ({ removed: false, t: 1, $key: 2 }) }));
    expect(findings("reserved-key").map(e => (e.data as any).key)).toEqual(["t", "$key"]);
  });

  it("a stand-in placed as text, stringified, or coerced renders NOTHING at t=0 too — the faces agree — with a dev finding each", async () => {
    // The document face has the t=0 value and the stream face never does;
    // rendering it at t=0 would make the first refetch change the page.
    const ServerComp = (props: any) => {
      const row = props.row({ id: 1 });
      return (
        <ul>
          <li>{row.title}</li>
          <li class={`todo ${row.title}`} title={`n=${row.count}`} />
          <li data-more={row.count > 3 ? "yes" : "no"} data-sum={row.count + 1} />
        </ul>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dsd3" }) as any;
    const html = plain(
      await document(() => Inline({ row: () => ({ title: "Hello <b>", count: 5 }) }))
    );
    expect(html).toContain("<li></li>");
    expect(html).toContain('<li class="todo " title="n="></li>');
    // A comparison on a stand-in is `undefined`-shaped: `"" > 3` is false.
    expect(html).toContain('<li data-more="no" data-sum="1"></li>');
    expect(findings("text").length).toBe(1);
    expect(findings("stringified").length).toBe(2);
    expect(findings("coerced").map(e => (e.data as any).key)).toEqual(["count"]);
  });
});
