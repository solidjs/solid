import { createMemo, createSignal, Loading, Reveal, Show } from "solid-js";

function delayedValue(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

function AsyncCard(props) {
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
  const [together, setTogether] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(true);
  const [seed, setSeed] = createSignal(1);

  return (
    <>
      <h1>Reveal</h1>
      <p>
        Compare reveal ordering with different mode combinations and rerun the async boundaries to
        watch reveal behavior during SSR/hydration.
      </p>
      <p>
        <strong>Run:</strong> {seed()}
      </p>
      <div
        style={{ display: "flex", gap: "1rem", "align-items": "center", "margin-bottom": "1rem" }}
      >
        <label>
          <input
            type="checkbox"
            checked={together()}
            onInput={e => setTogether(e.currentTarget.checked)}
          />{" "}
          together
        </label>
        <label>
          <input
            type="checkbox"
            checked={collapsed()}
            onInput={e => setCollapsed(e.currentTarget.checked)}
          />{" "}
          collapsed
        </label>
        <button onClick={() => setSeed(s => s + 1)}>Restart run</button>
      </div>

      <Show when={seed()} keyed>
        <h2>Primary Group</h2>
        <Reveal together={together()} collapsed={collapsed()}>
          <div class="reveal-grid">
            <AsyncCard title="A" delay={500} />
            <AsyncCard title="B" delay={1100} />
            <AsyncCard title="C" delay={1700} />
          </div>
        </Reveal>

        <h2>Nested Group</h2>
        <Reveal together={together()} collapsed={collapsed()}>
          <div class="reveal-grid">
            <AsyncCard title="Outer-1" delay={700} />
            <Reveal together={together()} collapsed={collapsed()}>
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
