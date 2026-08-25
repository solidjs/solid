// Duplicate attributes on the same element resolve to the last value
// (matching JSX spread semantics: later attributes override earlier ones).
// This test keeps the `class=` case specifically since it used to be a
// special compiler path.
const dynamicClass = () => "dyn";
const flag = true;

const t1 = (
  <div class="a" class="b">
    static static
  </div>
);

const t2 = (
  <div class="a" class={dynamicClass()}>
    static + dynamic
  </div>
);

const t3 = (
  <div class={dynamicClass()} class={flag ? "on" : "off"}>
    two dynamic
  </div>
);

const t4 = (
  <div class="base" class={{ active: flag, dim: !flag }}>
    string + object
  </div>
);

const t5 = (
  <div class="a" class="b" class="c">
    three statics
  </div>
);
