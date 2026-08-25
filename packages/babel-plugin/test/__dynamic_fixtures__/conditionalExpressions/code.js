const template1 = <div>{simple}</div>;

const template2 = <div>{state.dynamic}</div>;

const template3 = <div>{simple ? good : bad}</div>;

const template4 = <div>{simple ? good() : bad}</div>;
const template4a = <div>{simple ? good.good : bad}</div>;

const template5 = <div>{state.dynamic ? good() : bad}</div>;
const template5a = <div>{state.dynamic ? good.gppd : bad}</div>;

const template6 = <div>{state.dynamic && good()}</div>;
const template6a = <div>{state.dynamic && good.good}</div>;

const template7 = <div>{state.count > 5 ? (state.dynamic ? best : good()) : bad}</div>;
const template7a = <div>{state.count > 5 ? (state.dynamic ? best : good.good) : bad}</div>;

const template8 = <div>{state.dynamic && state.something && good()}</div>;
const template8a = <div>{state.dynamic && state.something && good.good}</div>;

const template9 = <div>{(state.dynamic && good()) || bad}</div>;
const template9a = <div>{(state.dynamic && good.good) || bad}</div>;

const template10 = <div>{state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback"}</div>;

const template11 = <div>{state.a ? a() : state.b ? b() : state.c ? "c" : "fallback"}</div>;
const template11a = <div>{state.a ? a.a : state.b ? b.b : state.c ? "c" : "fallback"}</div>;

const template12 = <Comp render={state.dynamic ? good() : bad} />;
const template12a = <Comp render={state.dynamic ? good.good : bad} />;

// no dynamic predicate
const template13 = <Comp render={state.dynamic ? good : bad} />;

const template14 = <Comp render={state.dynamic && good()} />;
const template14a = <Comp render={state.dynamic && good.good} />;

// no dynamic predicate
const template15 = <Comp render={state.dynamic && good} />;

const template16 = <Comp render={state.dynamic || good()} />;
const template16a = <Comp render={state.dynamic || good.good} />;

const template17 = <Comp render={state.dynamic ? <Comp /> : <Comp />} />;

const template18 = <Comp>{state.dynamic ? <Comp /> : <Comp />}</Comp>;

const template19 = <div innerHTML={state.dynamic ? <Comp /> : <Comp />} />;

const template20 = <div>{state.dynamic ? <Comp /> : <Comp />}</div>;

const template21 = <Comp render={state?.dynamic ? "a" : "b"} />;

const template22 = <Comp>{state?.dynamic ? "a" : "b"}</Comp>;

const template23 = <div innerHTML={state?.dynamic ? "a" : "b"} />;

const template24 = <div>{state?.dynamic ? "a" : "b"}</div>;

const template25 = <Comp render={state.dynamic ?? <Comp />} />;

const template26 = <Comp>{state.dynamic ?? <Comp />}</Comp>;

const template27 = <div innerHTML={state.dynamic ?? <Comp />} />;

const template28 = <div>{state.dynamic ?? <Comp />}</div>;

const template29 = <div>{(thing() && thing1()) ?? thing2() ?? thing3()}</div>;
const template29a = <div>{(thing.thing && thing1.thing1) ?? thing2.thing2 ?? thing3.thing3}</div>;

const template30 = <div>{thing() || thing1() || thing2()}</div>;
const template30a = <div>{thing.thing || thing1.thing1 || thing2.thing2}</div>;

const template31 = <Comp value={count() ? (count() ? count() : count()) : count()} />;
const template31a = (
  <Comp value={count.count ? (count.count ? count.count : count.count) : count.count} />
);

const template32 = <div>{something?.()}</div>;

const template33 = <Comp>{something?.()}</Comp>;

const template34 = <>{simple ? good : bad}</>;

const template35 = <>{simple ? good() : bad}</>;
const template35a = <>{simple ? good.good : bad}</>;

const template36 = <>{state.dynamic ? good() : bad}</>;
const template36a = <>{state.dynamic ? good.good : bad}</>;

const template37 = <>{state.dynamic && good()}</>;
const template37a = <>{state.dynamic && good.good}</>;

const template38 = <>{state.count > 5 ? (state.dynamic ? best : good()) : bad}</>;
const template38a = <>{state.count > 5 ? (state.dynamic ? best : good.good) : bad}</>;

const template39 = <>{state.dynamic && state.something && good()}</>;
const template39a = <>{state.dynamic && state.something && good.good}</>;

const template40 = <>{(state.dynamic && good()) || bad}</>;
const template40a = <>{(state.dynamic && good.good) || bad}</>;

const template41 = <>{state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback"}</>;

const template42 = <>{state.a ? a() : state.b ? b() : state.c ? "c" : "fallback"}</>;
const template42a = <>{state.a ? a.a : state.b ? b.b : state.c ? "c" : "fallback"}</>;

const template43 = <>{obj1.prop ? obj2.prop ? <div>Output</div> : <></> : <></>}</>;

// statically boolean left: memo value IS the expression value, logical form kept
const template77 = <>{state.count > 5 && good()}</>;
const template77a = <>{!state.hidden && good.good}</>;
