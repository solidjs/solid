import * as S from "s-js";

describe("Test Synthetic event bubbling", () => {
  const Elements = {
    el1: null,
    el2: null,
    el3: null
  };
  let eventTarget = null,
    count = 0,
    stopPropagation = false;
  function handleClick(data, e) {
    expect(e.currentTarget).toBe(Elements[`el${data}`]);
    expect(e.target).toBe(eventTarget);
    if (stopPropagation) e.stopPropagation();
    count++;
  }

  document.body.innerHTML = "";
  S.root(() =>
    document.body.appendChild(
      <div ref={Elements.el1} onClick={[handleClick, 1]}>
        <div ref={Elements.el2} onClick={[handleClick, 2]}>
          <div ref={Elements.el3} onClick={[handleClick, 3]} />
        </div>
      </div>
    )
  );

  test("Fire top level event", () => {
    eventTarget = Elements.el1;
    count = 0;
    var event = new MouseEvent("click", { bubbles: true });
    eventTarget.dispatchEvent(event);
    expect(count).toBe(1);
  });

  test("Fire 2nd level event", () => {
    eventTarget = Elements.el2;
    count = 0;
    var event = new MouseEvent("click", { bubbles: true });
    eventTarget.dispatchEvent(event);
    expect(count).toBe(2);
  });

  test("Fire 3rd level event", () => {
    eventTarget = Elements.el3;
    count = 0;
    var event = new MouseEvent("click", { bubbles: true });
    eventTarget.dispatchEvent(event);
    expect(count).toBe(3);
  });

  test("Fire 3rd level event and stop propagation", () => {
    eventTarget = Elements.el3;
    count = 0;
    stopPropagation = true;
    var event = new MouseEvent("click", { bubbles: true });
    eventTarget.dispatchEvent(event);
    expect(count).toBe(1);
  });
});
