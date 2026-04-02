import { createMemo, createSignal, Errored, Loading } from "solid-js";

async function loadItem(id) {
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (id !== "1") {
    throw new Error(`Item ${id} not found`);
  }
  return { title: "Test Item" };
}

function InnerBoundaryItem(props) {
  const [id, setId] = createSignal(props.id);
  const item = createMemo(() => loadItem(id()));

  return (
    <Loading fallback={<div>Item Loading...</div>}>
      <Errored
        fallback={(error, reset) => (
          <div>
            <div>ItemError: {String(error)}</div>
            <button
              onClick={() => {
                setId("1");
                queueMicrotask(reset);
              }}
            >
              Reset to valid item
            </button>
          </div>
        )}
      >
        <div>{item().title}</div>
      </Errored>
    </Loading>
  );
}

function OuterBoundaryItem(props) {
  const [id, setId] = createSignal(props.id);
  const item = createMemo(() => loadItem(id()));

  return (
    <Errored
      fallback={(error, reset) => (
        <div>
          <div>ItemError: {String(error)}</div>
          <button
            onClick={() => {
              setId("1");
              reset();
            }}
          >
            Reset to valid item
          </button>
        </div>
      )}
    >
      <Loading fallback={<div>Item Loading...</div>}>
        <div>{item().title}</div>
      </Loading>
    </Errored>
  );
}

const ErrorStream = () => {
  return (
    <>
      <h1>Loading + Errored Streaming</h1>
      <p>
        Reproduces both boundary shapes for streamed SSR + hydration, with reset buttons to confirm
        recovery after hydration.
      </p>
      <h2>Errored inside Loading</h2>
      <div>
        <InnerBoundaryItem id="1" />
        <InnerBoundaryItem id="bad-item" />
      </div>
      <h2>Errored outside Loading</h2>
      <div>
        <OuterBoundaryItem id="1" />
        <OuterBoundaryItem id="bad-item" />
      </div>
    </>
  );
};

export default ErrorStream;
