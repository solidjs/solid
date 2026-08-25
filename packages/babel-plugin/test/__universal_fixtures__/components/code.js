import { Show, binding } from "somewhere";

function refFn() {}
const refConst = null;

const Child = props => (
  <>
    <div ref={props.ref}>Hello {props.name}</div>
    <div>{props.children}</div>
  </>
);

const template = props => {
  let childRef;
  const { content } = props;
  return (
    <div>
      <Child name="John" {...props} ref={childRef} booleanProperty>
        <div>From Parent</div>
      </Child>
      <Child name="Jason" {...dynamicSpread()} ref={props.ref}>
        {/* Comment Node */}
        <div>{content}</div>
      </Child>
      <Context.Consumer ref={props.consumerRef()}>{context => context}</Context.Consumer>
    </div>
  );
};

const template2 = (
  <Child
    name="Jake"
    dynamic={state.data}
    stale={/*@static*/ state.data}
    handleClick={clickHandler}
    hyphen-ated={state.data}
    ref={el => (e = el)}
  />
);

const template3 = (
  <Child>
    <div />
    <div />
    <div />
    After
  </Child>
);

const template4 = <Child>{<div />}</Child>;

const template5 = <Child dynamic={state.dynamic}>{state.dynamic}</Child>;

// builtIns
const template6 = (
  <For each={state.list} fallback={<Loading />}>
    {item => <Show when={state.condition}>{item}</Show>}
  </For>
);

const template7 = (
  <Child>
    <div />
    {state.dynamic}
  </Child>
);

const template8 = (
  <Child>
    {item => item}
    {item => item}
  </Child>
);

const template9 = <_garbage>Hi</_garbage>;

const template10 = (
  <div>
    <Link>new</Link>
    {" | "}
    <Link>comments</Link>
    {" | "}
    <Link>show</Link>
    {" | "}
    <Link>ask</Link>
    {" | "}
    <Link>jobs</Link>
    {" | "}
    <Link>submit</Link>
  </div>
);

const template11 = (
  <div>
    <Link>new</Link>
    {" | "}
    <Link>comments</Link>
    <Link>show</Link>
    {" | "}
    <Link>ask</Link>
    <Link>jobs</Link>
    {" | "}
    <Link>submit</Link>
  </div>
);

const template12 = (
  <div>
    {" | "}
    <Link>comments</Link>
    {" | "}
    {" | "}
    {" | "}
    <Link>show</Link>
    {" | "}
  </div>
);

class Template13 {
  render() {
    <Component prop={this.something} onClick={() => this.shouldStay}>
      <Nested prop={this.data}>{this.content}</Nested>
    </Component>;
  }
}

const Template14 = <Component>{data()}</Component>;

const Template15 = <Component {...props} />;

const Template16 = <Component something={something} {...props} />;

const Template17 = (
  <Pre>
    <span>1</span> <span>2</span> <span>3</span>
  </Pre>
);
const Template18 = (
  <Pre>
    <span>1</span>
    <span>2</span>
    <span>3</span>
  </Pre>
);

const Template19 = <Component {...s.dynamic()} />;

const Template20 = <Component class={prop.red ? "red" : "green"} />;

const template21 = (
  <Component
    {...{
      get [key()]() {
        return props.value;
      }
    }}
  />
);

const template22 = <Component passObject={{ ...a }}></Component>;

const template23 = <Component ref={binding} />;
const template24 = <Component ref={binding.prop} />;
const template25 = <Component ref={refFn} />;
const template26 = <Component ref={refConst} />;

const template27 = <Component ref={refUnknown} />;
const template28 = <Component ref={binding?.prop} />;
const template29 = <Component ref={binding?.[prop]} />;
const template30 = <Component ref={binding.nested?.prop} />;
