export const App = () => {
  class K extends Base {
    static s = 2;
    #p = 3;
    constructor(a) { super(a); this.a = a; }
    get g() { return this.#p; }
    static m() { return K.s; }
    [computed]() {}
    async am() {}
    *gm() { yield 1; }
    static { init(); }
  }
  return new K(1);
};
