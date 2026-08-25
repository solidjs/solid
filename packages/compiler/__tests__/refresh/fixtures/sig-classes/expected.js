import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => {
  class K extends Base {
    static s = 2;
    #p = 3;
    constructor(a) {
      super(a);
      this.a = a;
    }
    get g() {
      return this.#p;
    }
    static m() {
      return K.s;
    }
    [computed]() {}
    async am() {}
    *gm() {
      yield 1;
    }
    static {
      init();
    }
  }
  return new K(1);
}, {
  location: "src/sig-classes.jsx:1:19",
  signature: "6b6b92f",
  dependencies: () => ({
    Base: Base,
    computed: computed,
    init: init
  })
});
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
