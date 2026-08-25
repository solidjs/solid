// Multiple class= attributes on a DOM element should be combined into
// a single class attribute/expression.
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
    mixed
  </div>
);
const t5 = (
  <div class="a" class="b" class="c">
    three statics
  </div>
);
