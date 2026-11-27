// #5208: production stored a non-function effect return and called it on the
// next run. `f?.()` only skips null and undefined, so a string (what a setter
// returns) threw inside the runtime and halted every later update.
import {
  createEffect,
  createRoot,
  createSignal,
  flush,
  resetErrorHalt
} from "../dist/prod/index.js";

afterEach(() => {
  resetErrorHalt();
});

it("does not halt later runs when an effect returns a non-function cleanup", () => {
  const [label, setHeld, dispose] = createRoot(dispose => {
    const [held, writeHeld] = createSignal(false);
    const [readLabel, writeLabel] = createSignal("nothing yet");
    createEffect(
      () => held(),
      one => writeLabel(one ? "held" : "free")
    );
    return [readLabel, writeHeld, dispose] as const;
  });

  flush();
  expect(label()).toBe("free");

  setHeld(true);
  flush();
  expect(label()).toBe("held");

  setHeld(false);
  flush();
  expect(label()).toBe("free");

  dispose();
});
