// Duplicate attributes (not just `class`) resolve to the last value.
const dynamicId = () => "dyn-id";

// Same attribute twice, both static.
const t1 = (
  <div id="first" id="second">
    id
  </div>
);

// Static then dynamic — dynamic wins.
const t2 = (
  <div title="static" title={dynamicId()}>
    title
  </div>
);

// Dynamic then static — static wins.
const t3 = (
  <div data-x={dynamicId()} data-x="fixed">
    data
  </div>
);

// Namespaced (xlink:href) duplicates.
const t4 = (
  <svg>
    <use xlink:href="#a" xlink:href="#b" />
  </svg>
);

// Boolean attribute duplicated with different values.
const t5 = <input disabled disabled={false} />;
