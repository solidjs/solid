import { onSettled } from "solid-js";
import { CANVAS_H, CANVAS_W, createLogoCanvasPainter, REVEAL_MS } from "./logoCanvas";

export function Canvas() {
  let el!: HTMLCanvasElement;
  let painter!: ReturnType<typeof createLogoCanvasPainter>;

  let startedAt = 0;
  let rafId = 0;
  let splats = 0;

  const tick = () => {
    painter.drawUntil((performance.now() - startedAt) / REVEAL_MS);
    rafId = requestAnimationFrame(tick);
  };

  const onClick = (ev: MouseEvent) => {
    const rect = el.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((ev.clientY - rect.top) / rect.height) * CANVAS_H;
    painter.splat(x, y, ++splats);
  };

  onSettled(() => {
    painter.reset();
    el.addEventListener("click", onClick);
    startedAt = performance.now();
    rafId = requestAnimationFrame(tick);
    return () => {
      el.removeEventListener("click", onClick);
      cancelAnimationFrame(rafId);
    };
  });

  return (
    <canvas
      class="canvas"
      width={CANVAS_W}
      height={CANVAS_H}
      ref={nextEl => {
        el = nextEl;
        painter = createLogoCanvasPainter(nextEl.getContext("2d")!);
      }}
    />
  );
}
