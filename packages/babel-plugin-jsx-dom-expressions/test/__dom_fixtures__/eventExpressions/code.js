const template = (
  <div id="main">
    <button onchange={() => console.log("bound")}>Change Bound</button>
    <button onChange={[id => console.log("bound", id), id]}>Change Bound</button>
    <button onclick={() => console.log("delegated")}>Click Delegated</button>
    <button onClick={[id => console.log("delegated", id), rowId]}>Click Delegated</button>
    <button
      on={{
        click: () => console.log("listener"),
        "CAPS-ev": () => console.log("custom")
      }}
    >
      Click Listener
    </button>
    <button
      onCapture={{
        camelClick: () => console.log("listener")
      }}
    >
      Click Capture
    </button>
  </div>
);
