import { createMemo, createSignal, Loading, Reveal, Show, type RevealOrder } from "solid-js";

function delayedValue<T>(ms: number, value: T): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

function AsyncCard(props: { delay: number; title: string }) {
  const value = createMemo(() =>
    delayedValue(props.delay, `${props.title} resolved in ${props.delay}ms`)
  );

  return (
    <Loading fallback={<div class="loader">{props.title} loading...</div>}>
      <div class="reveal-card">
        <strong>{props.title}</strong>
        <div>{value()}</div>
      </div>
    </Loading>
  );
}

const RevealPage = () => {
  const [order, setOrder] = createSignal<RevealOrder>("sequential");
  const [collapsed, setCollapsed] = createSignal(true);
  const [seed, setSeed] = createSignal(1);

  return (
    <>
      <h1>Reveal</h1>
      <p>
        Compare reveal ordering with different <code>order</code> modes and watch the nested group
        behave as a single composite slot inside its parent. Restart the run to replay SSR and
        hydration timings.
      </p>
      <p>
        <strong>Run:</strong> {seed()}
      </p>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          "align-items": "center",
          "margin-bottom": "1rem",
          "flex-wrap": "wrap"
        }}
      >
        <fieldset style={{ display: "flex", gap: "0.75rem", "align-items": "center" }}>
          <legend>order</legend>
          <label>
            <input
              type="radio"
              name="order"
              value="sequential"
              checked={order() === "sequential"}
              onInput={() => setOrder("sequential")}
            />{" "}
            sequential
          </label>
          <label>
            <input
              type="radio"
              name="order"
              value="together"
              checked={order() === "together"}
              onInput={() => setOrder("together")}
            />{" "}
            together
          </label>
          <label>
            <input
              type="radio"
              name="order"
              value="natural"
              checked={order() === "natural"}
              onInput={() => setOrder("natural")}
            />{" "}
            natural
          </label>
        </fieldset>
        <label title="Only applies when order is sequential">
          <input
            type="checkbox"
            checked={collapsed()}
            disabled={order() !== "sequential"}
            onInput={e => setCollapsed(e.currentTarget.checked)}
          />{" "}
          collapsed <em>(sequential only)</em>
        </label>
        <button onClick={() => setSeed(s => s + 1)}>Restart run</button>
      </div>

      <Show when={seed()} keyed>
        <h2>Primary Group</h2>
        <p>
          Three siblings under a single <code>{`<Reveal order="${order()}">`}</code>. Compare how
          they swap in as each resolves.
        </p>
        <Reveal order={order()} collapsed={collapsed()}>
          <div class="reveal-grid">
            <AsyncCard title="A" delay={500} />
            <AsyncCard title="B" delay={1100} />
            <AsyncCard title="C" delay={1700} />
          </div>
        </Reveal>

        <h2>Nested Group</h2>
        <p>
          The outer group uses <code>order="{order()}"</code>. The inner group is always{" "}
          <code>order="natural"</code> — it registers as a single composite slot to the outer group
          and, once the outer releases it, each inner card reveals on its own.
        </p>
        <Reveal order={order()} collapsed={collapsed()}>
          <div class="reveal-grid">
            <AsyncCard title="Outer-1" delay={700} />
            <Reveal order="natural">
              <div class="reveal-grid">
                <AsyncCard title="Inner-1" delay={900} />
                <AsyncCard title="Inner-2" delay={1300} />
              </div>
            </Reveal>
            <AsyncCard title="Outer-2" delay={1500} />
          </div>
        </Reveal>
      </Show>
    </>
  );
};

export default RevealPage;
