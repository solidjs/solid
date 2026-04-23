import { createSignal, onCleanup, createMemo, Loading } from "solid-js";
import { render } from "@solidjs/web";

type TriangleProps = {
  x: number;
  y: number;
  s: number;
  children: number;
};

const TARGET = 25;

const TriangleDemo = () => {
  const [elapsed, setElapsed] = createSignal(0),
    [seconds, setSeconds] = createSignal(0),
    scale = createMemo(() => {
      const e = (elapsed() / 1000) % 10;
      return 1 + (e > 5 ? 10 - e : e) / 10;
    }),
    start = Date.now(),
    t = setInterval(() => setSeconds(s => (s % 10) + 1), 1000);

  let f: number;
  const update = () => {
    setElapsed(Date.now() - start);
    f = requestAnimationFrame(update);
  };
  f = requestAnimationFrame(update);

  onCleanup(() => {
    clearInterval(t);
    cancelAnimationFrame(f);
  });

  return (
    <Loading fallback={"Loading..."}>
      <div
        class="container"
        style={{
          transform: "scaleX(" + scale() / 2.1 + ") scaleY(0.7) translateZ(0.1px)"
        }}
      >
        <Triangle x={0} y={0} s={1000}>
          {seconds()}
        </Triangle>
      </div>
    </Loading>
  );
};

const Triangle = (props: TriangleProps) => {
  let { x, y, s } = props;
  if (s <= TARGET) {
    return (
      <Dot x={x - TARGET / 2} y={y - TARGET / 2} s={TARGET}>
        {props.children}
      </Dot>
    );
  }
  s = s / 2;

  const slowChildren = createMemo(() => {
    const seconds = props.children;
    return new Promise<number>(res => {
      const t = requestIdleCallback(() => {
        const e = performance.now() + 0.8;
        while (performance.now() < e) {}
        res(seconds);
      });
      onCleanup(() => cancelIdleCallback(t));
    });
  });

  return (
    <>
      <Triangle x={x} y={y - s / 2} s={s}>
        {slowChildren()}
      </Triangle>
      <Triangle x={x - s} y={y + s / 2} s={s}>
        {slowChildren()}
      </Triangle>
      <Triangle x={x + s} y={y + s / 2} s={s}>
        {slowChildren()}
      </Triangle>
    </>
  );
};

const Dot = (props: TriangleProps) => {
  const { x, y, s } = props;
  const [hover, setHover] = createSignal(false),
    onEnter = () => setHover(true),
    onExit = () => setHover(false);

  return (
    <div
      class="dot"
      style={{
        width: s + "px",
        height: s + "px",
        left: x + "px",
        top: y + "px",
        "border-radius": s / 2 + "px",
        "line-height": s + "px",
        background: hover() ? "#ff0" : "#61dafb"
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onExit}
    >
      {hover() ? "**" + props.children + "**" : props.children}
    </div>
  );
};

render(TriangleDemo, document.body);
