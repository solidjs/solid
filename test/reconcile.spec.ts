import { createState, reconcile, unwrap } from "../src";

describe("setState with reconcile", () => {
  test("Reconcile a simple object", () => {
    var [state, setState] = createState({ data: 2, missing: "soon" });
    expect(state.data).toBe(2);
    expect(state.missing).toBe("soon");
    setState(reconcile({ data: 5 }));
    expect(state.data).toBe(5);
    expect(state.missing).toBeUndefined();
  });

  test("Reconcile a simple object on a nested path", () => {
    var [state, setState] = createState({
      data: { user: { firstName: "John", middleName: "", lastName: "Snow" } }
    });
    expect(state.data.user.firstName).toBe("John");
    expect(state.data.user.lastName).toBe("Snow");
    setState("data", "user", reconcile({ firstName: "Jake", middleName: "R" }));
    expect(state.data.user.firstName).toBe("Jake");
    expect(state.data.user.middleName).toBe("R");
    expect(state.data.user.lastName).toBeUndefined();
  });

  test("Reconcile reorder a keyed array", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" },
      BRANDON = { id: 3, firstName: "Brandon", lastName: "Start" },
      ARYA = { id: 4, firstName: "Arya", lastName: "Start" };
    var [state, setState] = createState({ users: [JOHN, NED, BRANDON] });
    expect(Object.is(unwrap(state.users[0]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), BRANDON)).toBe(true);
    setState("users", reconcile([NED, JOHN, BRANDON]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), BRANDON)).toBe(true);
    setState("users", reconcile([NED, BRANDON, JOHN]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), JOHN)).toBe(true);
    setState("users", reconcile([NED, BRANDON, JOHN, ARYA]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[3]), ARYA)).toBe(true);
    setState("users", reconcile([BRANDON, JOHN, ARYA]));
    expect(Object.is(unwrap(state.users[0]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), ARYA)).toBe(true);
  });

  test("Reconcile overwrite in non-keyed merge mode", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" },
      BRANDON = { id: 3, firstName: "Brandon", lastName: "Start" };
    var [state, setState] = createState({
      users: [{ ...JOHN }, { ...NED }, { ...BRANDON }]
    });
    expect(state.users[0].id).toBe(1);
    expect(state.users[0].firstName).toBe("John");
    expect(state.users[1].id).toBe(2);
    expect(state.users[1].firstName).toBe("Ned");
    expect(state.users[2].id).toBe(3);
    expect(state.users[2].firstName).toBe("Brandon");
    setState(
      "users",
      reconcile([{ ...NED }, { ...JOHN }, { ...BRANDON }], {
        merge: true,
        key: null
      })
    );
    expect(state.users[0].id).toBe(2);
    expect(state.users[0].firstName).toBe("Ned");
    expect(state.users[1].id).toBe(1);
    expect(state.users[1].firstName).toBe("John");
    expect(state.users[2].id).toBe(3);
    expect(state.users[2].firstName).toBe("Brandon");
  });
});
