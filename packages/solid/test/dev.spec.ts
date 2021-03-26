import {
  createRoot,
  getOwner,
  createSignal,
  createState,
  createEffect,
  serializeGraph,
  createComponent
} from "../src";

describe("Dev features", () => {
  test("Reactive graph serialization", () => {
    let owner: ReturnType<typeof getOwner>, set1: (v: number) => number, setState1: any;

    const SNAPSHOTS = [
      `{"s1773325850":5,"s1773325850-1":5,"c-1":{"explicit":6},"CustomComponent:c-2":{"s533736025":{"firstName":"John","lastName":"Smith"}}}`,
      `{"s1773325850":7,"s1773325850-1":5,"c-1":{"explicit":6},"CustomComponent:c-2":{"s533736025":{"firstName":"Matt","lastName":"Smith","middleInitial":"R."}}}`
    ];
    const CustomComponent = () => {
      const [state, setState] = createState({ firstName: "John", lastName: "Smith" });
      setState1 = setState;
      return "";
    }
    createRoot(() => {
      owner = getOwner();
      const [s, set] = createSignal(5);
      const [s2] = createSignal(5);
      createEffect(() => {
        const [s] = createSignal(6, false, { name: "explicit" });
      });
      createComponent(CustomComponent, {});
      set1 = set;
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
