/** @vitest-environment jsdom */
import {
  createRoot,
  createSignal,
  createEffect,
  createRenderEffect,
  createComputed,
  createReaction,
  createDeferred,
  createMemo,
  createSelector,
  untrack,
  on,
  onMount,
  onCleanup,
  catchError,
  createContext,
  useContext,
  getOwner,
  runWithOwner
} from "../src";

import "./MessageChannel";

describe("Create signals", () => {
  test("Create and read a Signal", () => {
    const [value] = createSignal(5);
    expect(value()).toBe(5);
  });
  test("Create and read a Signal with comparator", () => {
    const [value] = createSignal(5, { equals: (a, b) => a === b });
    expect(value()).toBe(5);
  });
  test("Create and read a Memo", () => {
    createRoot(() => {
      const memo = createMemo(() => "Hello");
      expect(memo()).toBe("Hello");
    });
  });
  test("Create and read a Memo with initial value", () => {
    createRoot(() => {
      const memo = createMemo(i => `${i} John`, "Hello");
      expect(memo()).toBe("Hello John");
    });
  });
  test("Create onMount", () => {
    let temp: string;
    createRoot(() => {
      onMount(() => (temp = "impure"));
    });
    expect(temp!).toBe("impure");
  });
  test("Create a Effect with explicit deps", () => {
    let temp: string;
    createRoot(() => {
      const [sign] = createSignal("thoughts");
      const fn = on(sign, v => (temp = `impure ${v}`));
      createEffect(fn);
      createEffect(on(sign, v => (temp = `impure ${v}`)));
    });
    expect(temp!).toBe("impure thoughts");
  });
  test("Create a Effect with multiple explicit deps", () => {
    let temp: string;
    createRoot(() => {
      const [sign] = createSignal("thoughts");
      const [num] = createSignal(3);
      const fn = on([sign, num], v => (temp = `impure ${v[1]}`));
      createEffect(fn);
    });
    expect(temp!).toBe("impure 3");
  });
  test("Create a Effect with explicit deps and lazy evaluation", () => {
    let temp: string;
    const [sign, set] = createSignal("thoughts");
    createRoot(() => {
      const fn = on(sign, v => (temp = `impure ${v}`), { defer: true });
      createEffect(fn);
    });
    expect(temp!).toBeUndefined();
    set("minds");
    expect(temp!).toBe("impure minds");
  });
});

describe("Update signals", () => {
  test("Create and update a Signal", () => {
    const [value, setValue] = createSignal(5);
    setValue(10);
    expect(value()).toBe(10);
  });
  test("Create and update a Signal with fn", () => {
    const [value, setValue] = createSignal(5);
    setValue(p => p + 5);
    expect(value()).toBe(10);
  });
  test("Create Signal and set different value", () => {
    const [value, setValue] = createSignal(5);
    setValue(10);
    expect(value()).toBe(10);
  });
  test("Create Signal and set equivalent value", () => {
    const [value, setValue] = createSignal(5, { equals: (a, b) => a > b });
    setValue(3);
    expect(value()).toBe(5);
  });
  test("Create and read a Signal with function value", () => {
    const [value, setValue] = createSignal<() => string>(() => "Hi");
    expect(value()()).toBe("Hi");
    setValue(() => () => "Hello");
    expect(value()()).toBe("Hello");
  });
  test("Create and trigger a Memo", () => {
    createRoot(() => {
      const [name, setName] = createSignal("John"),
        memo = createMemo(() => `Hello ${name()}`);
      expect(memo()).toBe("Hello John");
      setName("Jake");
      expect(memo()).toBe("Hello Jake");
    });
  });
  test("Create Signal and set equivalent value not trigger Memo", () => {
    createRoot(() => {
      const [name, setName] = createSignal("John", { equals: (a, b) => b.startsWith("J") }),
        memo = createMemo(() => `Hello ${name()}`);
      expect(name()).toBe("John");
      expect(memo()).toBe("Hello John");
      setName("Jake");
      expect(name()).toBe("John");
      expect(memo()).toBe("Hello John");
    });
  });
  test("Create and trigger a Memo in an effect", () =>
    new Promise(done => {
      createRoot(() => {
        let temp: string;
        const [name, setName] = createSignal("John"),
          memo = createMemo(() => `Hello ${name()}`);
        createEffect(() => (temp = `${memo()}!!!`));
        setTimeout(() => {
          expect(temp).toBe("Hello John!!!");
          setName("Jake");
          expect(temp).toBe("Hello Jake!!!");
          done(undefined);
        });
      });
    }));
  test("Create and trigger an Effect", () =>
    new Promise(done => {
      createRoot(() => {
        let temp: string;
        const [sign, setSign] = createSignal("thoughts");
        createEffect(() => (temp = `unpure ${sign()}`));
        setTimeout(() => {
          expect(temp).toBe("unpure thoughts");
          setSign("mind");
          expect(temp).toBe("unpure mind");
          done(undefined);
        });
      });
    }));
  test("Create and trigger an Effect with function signals", () =>
    new Promise(done => {
      createRoot(() => {
        let temp: string;
        const [sign, setSign] = createSignal<() => string>(() => "thoughts");
        createEffect(() => (temp = `unpure ${sign()()}`));
        setTimeout(() => {
          expect(temp).toBe("unpure thoughts");
          setSign(() => () => "mind");
          expect(temp).toBe("unpure mind");
          done(undefined);
        });
      });
    }));
  test("Set signal returns argument", () => {
    const [_, setValue] = createSignal<number>();
    const res1: undefined = setValue(undefined);
    expect(res1).toBe(undefined);
    const res2: number = setValue(12);
    expect(res2).toBe(12);
    const res3 = setValue(Math.random() >= 0 ? 12 : undefined);
    expect(res3).toBe(12);
    const res4 = setValue();
    expect(res4).toBe(undefined);
  });
});

describe("Untrack signals", () => {
  test("Mute an effect", () =>
    new Promise(done => {
      createRoot(() => {
        let temp: string;
        const [sign, setSign] = createSignal("thoughts");
        createEffect(() => (temp = `unpure ${untrack(sign)}`));
        setTimeout(() => {
          expect(temp).toBe("unpure thoughts");
          setSign("mind");
          expect(temp).toBe("unpure thoughts");
          done(undefined);
        });
      });
    }));
});

describe("Batching signals", () => {
  test("Mute an effect", () =>
    new Promise(done => {
      createRoot(() => {
        let temp: string;
        const [sign, setSign] = createSignal("thoughts");
        createEffect(() => (temp = `unpure ${untrack(sign)}`));
        setTimeout(() => {
          expect(temp).toBe("unpure thoughts");
          setSign("mind");
          expect(temp).toBe("unpure thoughts");
          done(undefined);
        });
      });
    }));
});

describe("Effect grouping of signals", () => {
  test("Groups updates", () =>
    new Promise(done => {
      createRoot(() => {
        let count = 0;
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        createEffect(() => {
          setA(1);
          setB(1);
        });
        createMemo(() => (count += a() + b()));
        setTimeout(() => {
          expect(count).toBe(2);
          done(undefined);
        });
      });
    }));
  test("Groups updates with repeated sets", () =>
    new Promise(done => {
      createRoot(() => {
        let count = 0;
        const [a, setA] = createSignal(0);
        createEffect(() => {
          setA(1);
          setA(4);
        });
        createMemo(() => (count += a()));
        setTimeout(() => {
          expect(count).toBe(4);
          done(undefined);
        });
      });
    }));
  test("Groups updates with fn setSignal", () =>
    new Promise(done => {
      createRoot(() => {
        let count = 0;
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        createEffect(() => {
          setA(a => a + 1);
          setB(b => b + 1);
        });
        createMemo(() => (count += a() + b()));
        setTimeout(() => {
          expect(count).toBe(2);
          done(undefined);
        });
      });
    }));
  test("Groups updates with fn setSignal with repeated sets", () =>
    new Promise(done => {
      createRoot(() => {
        let count = 0;
        const [a, setA] = createSignal(0);
        createEffect(() => {
          setA(a => a + 1);
          setA(a => a + 2);
        });
        createMemo(() => (count += a()));
        setTimeout(() => {
          expect(count).toBe(3);
          done(undefined);
        });
      });
    }));
  test("Test cross setting in a effect update", () =>
    new Promise(done => {
      createRoot(() => {
        let count = 0;
        const [a, setA] = createSignal(1);
        const [b, setB] = createSignal(0);
        createEffect(() => {
          setA(a => a + b());
        });
        createMemo(() => (count += a()));
        setTimeout(() => {
          setB(b => b + 1);
          setTimeout(() => {
            expect(count).toBe(3);
            done(undefined);
          });
        });
      });
    }));
  test("Handles errors gracefully", () =>
    new Promise(done => {
      createRoot(() => {
        let error: Error;
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        createEffect(() => {
          try {
            setA(1);
            throw new Error("test");
          } catch (e) {
            error = e as Error;
          }
        });
        createMemo(() => a() + b());
        setTimeout(() => {
          expect(a()).toBe(1);
          expect(b()).toBe(0);
          setA(2);
          expect(a()).toBe(2);
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe("test");
          done(undefined);
        });
      });
    }));

  test("Multiple sets", () =>
    new Promise(done => {
      createRoot(() => {
        let count = 0;
        const [a, setA] = createSignal(0);
        createEffect(() => {
          setA(1);
          setA(0);
        });
        createMemo(() => (count = a()));
        setTimeout(() => {
          expect(count).toBe(0);
          done(undefined);
        });
      });
    }));
});

describe("Typecheck computed and effects", () => {
  test("No default value can return undefined", () => {
    createRoot(() => {
      let count = 0;
      const [sign, setSign] = createSignal("thoughts");
      const fn = (arg?: number) => {
        count++;
        sign();
        expect(arg).toBe(undefined);
        return arg;
      };
      createComputed(fn);
      createRenderEffect(fn);
      createEffect(fn);
      setTimeout(() => {
        expect(count).toBe(3);
        setSign("update");
        expect(count).toBe(6);
      });
    });
  });
  test("Default value never receives undefined", () => {
    createRoot(() => {
      let count = 0;
      const [sign, setSign] = createSignal("thoughts");
      const fn = (arg: number) => {
        count++;
        sign();
        expect(arg).toBe(12);
        return arg;
      };
      createComputed(fn, 12);
      createRenderEffect(fn, 12);
      createEffect(fn, 12);
      setTimeout(() => {
        expect(count).toBe(3);
        setSign("update");
        expect(count).toBe(6);
      });
    });
  });
});

describe("onCleanup", () => {
  test("Clean an effect", () =>
    new Promise(done => {
      createRoot(() => {
        let temp: string;
        const [sign, setSign] = createSignal("thoughts");
        createEffect(() => {
          sign();
          onCleanup(() => (temp = "after"));
        });
        setTimeout(() => {
          expect(temp).toBeUndefined();
          setSign("mind");
          expect(temp).toBe("after");
          done(undefined);
        });
      });
    }));
  test("Explicit root disposal", () => {
    let temp: string | undefined, disposer: () => void;
    createRoot(dispose => {
      disposer = dispose;
      onCleanup(() => (temp = "disposed"));
    });
    expect(temp).toBeUndefined();
    disposer!();
    expect(temp).toBe("disposed");
  });
  test("Failed Root disposal from arguments", () => {
    let temp: string | undefined, disposer: () => void;
    createRoot((...args) => {
      disposer = args[0];
      onCleanup(() => (temp = "disposed"));
    });
    expect(temp).toBeUndefined();
    expect(disposer!).toThrow();
  });
});

describe("catchError", () => {
  test("No Handler", () => {
    expect(() =>
      createRoot(() => {
        throw "fail";
      })
    ).toThrow("fail");
  });
  test("Top level", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        catchError(
          () => {
            throw "fail";
          },
          () => (errored = true)
        );
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("Nested in catchError", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        catchError(
          () => {
            catchError(
              () => {
                throw "fail";
              },
              error => {
                throw error;
              }
            );
          },
          () => (errored = true)
        );
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In initial effect", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        createEffect(() => {
          catchError(
            () => {
              throw "fail";
            },
            () => (errored = true)
          );
        });
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  // test("With multiple error handlers", () => {
  //   let errored = false;
  //   let errored2 = false;
  //   expect(() =>
  //     createRoot(() => {
  //       createEffect(() => {
  //         onError(() => (errored = true));
  //         onError(() => (errored2 = true));
  //         throw "fail";
  //       });
  //     })
  //   ).not.toThrow("fail");
  //   expect(errored).toBe(true);
  //   expect(errored2).toBe(true);
  // });

  test("In update effect", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        const [s, set] = createSignal(0);
        createEffect(() => {
          const v = s();
          catchError(
            () => {
              if (v) throw "fail";
            },
            () => (errored = true)
          );
        });
        set(1);
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In initial nested effect", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        createEffect(() => {
          createEffect(() => {
            catchError(
              () => {
                throw "fail";
              },
              () => (errored = true)
            );
          });
        });
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In nested update effect", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        const [s, set] = createSignal(0);
        createEffect(() => {
          createEffect(() => {
            const v = s();
            catchError(
              () => {
                if (v) throw "fail";
              },
              () => (errored = true)
            );
          });
        });
        set(1);
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In nested update effect different levels", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        const [s, set] = createSignal(0);
        createEffect(() => {
          catchError(
            () =>
              createEffect(() => {
                const v = s();
                if (v) throw "fail";
              }),
            () => (errored = true)
          );
        });
        set(1);
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In nested memo", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        createMemo(() => {
          catchError(
            () => {
              createEffect(() => {});
              throw new Error("fail");
            },
            () => (errored = true)
          );
        });
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });
});

describe("createDeferred", () => {
  test("simple defer", () =>
    new Promise(done => {
      createRoot(() => {
        const [s, set] = createSignal("init"),
          r = createDeferred(s, { timeoutMs: 20 });
        expect(r()).toBe("init");
        set("Hi");
        expect(r()).toBe("init");
        setTimeout(() => {
          expect(r()).toBe("Hi");
          done(undefined);
        }, 100);
      });
    }));
});

describe("createSelector", () => {
  test("simple selection", () =>
    new Promise(done => {
      createRoot(() => {
        const [s, set] = createSignal<number>(),
          isSelected = createSelector(s);
        let count = 0;
        const list = Array.from({ length: 100 }, (_, i) =>
          createMemo(() => {
            count++;
            return isSelected(i) ? "selected" : "no";
          })
        );
        expect(count).toBe(100);
        expect(list[3]()).toBe("no");
        setTimeout(() => {
          count = 0;
          set(3);
          expect(count).toBe(1);
          expect(list[3]()).toBe("selected");
          count = 0;
          set(6);
          expect(count).toBe(2);
          expect(list[3]()).toBe("no");
          expect(list[6]()).toBe("selected");
          set(undefined);
          expect(count).toBe(3);
          expect(list[6]()).toBe("no");
          set(5);
          expect(count).toBe(4);
          expect(list[5]()).toBe("selected");
          done(undefined);
        });
      });
    }));

  test("double selection", () =>
    new Promise(done => {
      createRoot(() => {
        const [s, set] = createSignal<number>(-1),
          isSelected = createSelector<number, number>(s);
        let count = 0;
        const list = Array.from({ length: 100 }, (_, i) => [
          createMemo(() => {
            count++;
            return isSelected(i) ? "selected" : "no";
          }),
          createMemo(() => {
            count++;
            return isSelected(i) ? "oui" : "non";
          })
        ]);
        expect(count).toBe(200);
        expect(list[3][0]()).toBe("no");
        expect(list[3][1]()).toBe("non");
        setTimeout(() => {
          count = 0;
          set(3);
          expect(count).toBe(2);
          expect(list[3][0]()).toBe("selected");
          expect(list[3][1]()).toBe("oui");
          count = 0;
          set(6);
          expect(count).toBe(4);
          expect(list[3][0]()).toBe("no");
          expect(list[6][0]()).toBe("selected");
          expect(list[3][1]()).toBe("non");
          expect(list[6][1]()).toBe("oui");
          done(undefined);
        });
      });
    }));

  test("zero index", () =>
    new Promise(done => {
      createRoot(() => {
        const [s, set] = createSignal<number>(-1),
          isSelected = createSelector<number, number>(s);
        let count = 0;
        const list = [
          createMemo(() => {
            count++;
            return isSelected(0) ? "selected" : "no";
          })
        ];
        expect(count).toBe(1);
        expect(list[0]()).toBe("no");
        setTimeout(() => {
          count = 0;
          set(0);
          expect(count).toBe(1);
          expect(list[0]()).toBe("selected");
          count = 0;
          set(-1);
          expect(count).toBe(1);
          expect(list[0]()).toBe("no");
          done(undefined);
        });
      });
    }));
});

describe("create and use context", () => {
  test("createContext without arguments defaults to undefined", () => {
    const context = createContext<number>();
    const res = useContext(context);
    expect(res).toBe<typeof res>(undefined);
  });
});

describe("createRoot", () => {
  test("roots with dispose function unused are unowned", () => {
    createRoot(_ => {
      const root1 = getOwner()!;
      createRoot(_ => {
        const root2 = getOwner()!;
        createRoot(() => {
          const root3 = getOwner()!;
          expect(root2.owner).toBe(root1);
          expect(root3.owner).toBe(null);
        });
      });
    });
  });

  test("Allows to define detachedOwner", () => {
    let owner1: any;
    let owner2: any;
    let owner3: any;
    let owner4: any;
    let owner5: any;

    createRoot(_ => (owner1 = getOwner()!));
    createRoot(_ => (owner2 = getOwner()!), owner1);
    createRoot(_ => {
      owner3 = getOwner()!;
      createRoot(_ => (owner4 = getOwner()!));
      createRoot(_ => (owner5 = getOwner()!), null);
    });

    expect(owner1.owner).toBe(null);
    expect(owner2.owner).toBe(owner1);
    expect(owner3.owner).toBe(null);
    expect(owner4.owner).toBe(owner3);
    expect(owner5.owner).toBe(null);
  });
});

describe("runWithOwner", () => {
  test("Top level owner execute and disposal", () => {
    let effectRun = false;
    let cleanupRun = false;
    const [owner, dispose] = createRoot(dispose => {
      return [getOwner()!, dispose];
    });

    runWithOwner(owner, () => {
      createEffect(() => (effectRun = true));
      onCleanup(() => (cleanupRun = true));
      expect(effectRun).toBe(false);
      expect(cleanupRun).toBe(false);
    });
    expect(effectRun).toBe(true);
    expect(cleanupRun).toBe(false);
    dispose();
    expect(cleanupRun).toBe(true);
  });
});

describe("createReaction", () => {
  test("Create and trigger a Reaction", () =>
    new Promise(done => {
      createRoot(() => {
        let count = 0;
        const [sign, setSign] = createSignal("thoughts");
        const track = createReaction(() => count++);
        expect(count).toBe(0);
        track(sign);
        expect(count).toBe(0);
        setTimeout(() => {
          expect(count).toBe(0);
          setSign("mind");
          expect(count).toBe(1);
          setSign("body");
          expect(count).toBe(1);
          track(sign);
          setSign("everything");
          expect(count).toBe(2);
          done(undefined);
        });
      });
    }));
});
