function hoistedCustomEvent1() {
  console.log("hoisted");
}
const hoistedcustomevent2 = () => console.log("hoisted");

const template = (
  <div id="main">
    <button onChange={() => console.log("bound")}>Change Bound</button>
    <button onChange={[id => console.log("bound", id), id]}>Change Bound</button>
    <button onClick={() => console.log("delegated")}>Click Delegated</button>
    <button onClick={[id => console.log("delegated", id), rowId]}>Click Delegated</button>
  </div>
);

const lowercaseAttributes = (
  <div>
    <button onclick="console.log('static')">Static Attribute</button>
    <button onclick={code}>Identifier Attribute</button>
    <button onmouseover={state.code}>Dynamic Attribute</button>
    <button onclick={() => console.log("not a handler")}>Function Attribute</button>
    <button {...rest} onclick={code}>
      Spread Attribute
    </button>
  </div>
);
