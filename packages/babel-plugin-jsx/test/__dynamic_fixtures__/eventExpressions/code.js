function hoisted1() {
  console.log("hoisted");
}
const hoisted2 = () => console.log("hoisted delegated");

const template = (
  <div id="main">
    <button onchange={() => console.log("bound")}>Change Bound</button>
    <button onChange={[id => console.log("bound", id), id]}>Change Bound</button>
    <button onchange={handler}>Change Bound</button>
    <button onchange={[handler]}>Change Bound</button>
    <button onchange={hoisted1}>Change Bound</button>
    <button onclick={() => console.log("delegated")}>Click Delegated</button>
    <button onClick={[id => console.log("delegated", id), rowId]}>Click Delegated</button>
    <button onClick={handler}>Click Delegated</button>
    <button onClick={[handler]}>Click Delegated</button>
    <button onClick={hoisted2}>Click Delegated</button>
  </div>
);
