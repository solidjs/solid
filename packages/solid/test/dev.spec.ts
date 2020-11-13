import {
  createRoot,
  getContextOwner,
  createSignal,
  createState,
  createEffect,
  serializeGraph
} from "../src";

describe("Dev features", () => {
  test("Reactive graph serialization", () => {
    let owner: ReturnType<typeof getContextOwner>, set1: (v: number) => number, setState1: any;

    const SNAPSHOTS = [
      `{"s1773325850":5,"s1773325850_1":5,"s533736025":{"firstName":"John","lastName":"Smith"},"children":[{"explicit":6}]}`,
      `{"s1773325850":7,"s1773325850_1":5,"s533736025":{"firstName":"Matt","lastName":"Smith","middleInitial":"R."},"children":[{"explicit":6}]}`
    ];
    createRoot(() => {
      owner = getContextOwner();
      const [s, set] = createSignal(5);
      const [s2] = createSignal(5);
      createEffect(() => {
        const [s] = createSignal(6, false, { name: "explicit" });
      });
      const [state, setState] = createState({ firstName: "John", lastName: "Smith" });
      set1 = set;
      setState1 = setState;
    });
    expect(JSON.stringify(serializeGraph(owner!))).toBe(SNAPSHOTS[0]);
    set1!(7);
    setState1({ middleInitial: "R.", firstName: "Matt" });
    expect(JSON.stringify(serializeGraph(owner!))).toBe(SNAPSHOTS[1]);
  });

  test("AfterUpdate Hook", () => {
    let triggered = 0;
    let set1: (v: number) => number, setState1: any;
    global._$afterUpdate = () => triggered++;
    createRoot(() => {
      const [s, set] = createSignal(5);
      const [s2] = createSignal(5);
      createEffect(() => {
        const [s] = createSignal(6, false, { name: "explicit" });
      });
      const [state, setState] = createState({ firstName: "John", lastName: "Smith" });
      createEffect(() => {
        s();
        s2();
        state.firstName;
      });
      set1 = set;
      setState1 = setState;
    });
    expect(triggered).toBe(1);
    set1!(7);
    expect(triggered).toBe(2);
    setState1({ middleInitial: "R.", firstName: "Matt" });
    expect(triggered).toBe(3);
  })
});
