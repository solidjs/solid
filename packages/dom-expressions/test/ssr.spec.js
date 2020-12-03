import * as r from "../src/asyncSSR";
import * as r2 from "../src/syncSSR";
import * as S from "s-js";

const fixture = `<div id="main" data-id="12" aria-role="button" checked class="selected" style="color:red"><h1 custom-attr="1" disabled title="Hello John" style="background-color:red" class="selected"><a href="/">Welcome</a></h1></div>`;
const fixture2 = `<span> Hello &lt;div/> </span>`;

const Comp1 = () => {
  const selected = S.data(true),
    welcoming = S.data("Hello John"),
    color = S.data("red"),
    results = {
      "data-id": "12",
      "aria-role": "button",
      get checked() { return selected() }
    },
    dynamic = () => ({
      "custom-attr": "1"
    });

  return r.ssr`<div id="main" ${r.ssrSpread(results, false, true)} class="${r.ssrClassList({
    selected: selected()
  })}" style="${r.ssrStyle({
    color: color()
  })}"${r.ssrBoolean("disabled", !selected())}><h1 ${r.ssrSpread(
    () => dynamic(),
    false,
    true
  )}${r.ssrBoolean("disabled", selected())} title="${() => welcoming()}" style="${() =>
    r.ssrStyle({
      "background-color": color()
    })}" class="${() =>
    r.ssrClassList({
      selected: selected()
    })}"><a href="/">Welcome</a></h1></div>`;
};

const Comp2 = () => {
  const greeting = "Hello",
    name = "<div/>";
  return r.ssr`<span> ${r.escape(greeting)} ${r.escape(name)} </span>`;
};

describe("renderToString", () => {
  it("renders as expected", async () => {
    let res = r.renderToString(Comp1);
    expect(res).toBe(fixture);
    res = r.renderToString(Comp2);
    expect(res).toBe(fixture2);
  });
});

describe("renderToNodeStream", () => {
  function streamToString(stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
      stream.on("data", chunk => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }
  it("renders as expected", async () => {
    let res = await streamToString(r2.renderToNodeStream(Comp2));
    expect(res).toBe(fixture2);
  });
});

// describe("renderToWebStream", () => {
//   function streamToString (stream) {
//     const chunks = []
//     const reader = stream.getReader()
//     return reader.read().then(function processText({ done, value }) {
//       if (done) return chunks.join("");
//       chunks.push(value);
//       return reader.read().then(processText);
//     });
//   }
//   it("renders as expected", async () => {
//     let res = await streamToString(r2.renderToWebStream(Comp2));
//     expect(res).toBe(fixture2);
//   });
// });
