type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
interface Runtime {
  insert(parent: MountableElement, accessor: any, marker?: Node | null, init?: any): any;
  spread(node: Element, accessor: any, isSVG?: Boolean, skipChildren?: Boolean): void;
  assign(node: Element, props: any, isSVG?: Boolean, skipChildren?: Boolean): void;
  createComponent(Comp: (props: any) => any, props: any): any;
  dynamicProperty(props: any, key: string): any;
  SVGElements: Set<string>;
}

type ExpandableNode = Node & { [key: string]: any };
type Props = { [key: string]: any };

export type HyperScript = {
  (...args: any[]): ExpandableNode | ExpandableNode[];
};

// Inspired by https://github.com/hyperhype/hyperscript
export function createHyperScript(r: Runtime): HyperScript {
  function h() {
    let args: any = [].slice.call(arguments),
      e: ExpandableNode | undefined,
      multiExpression = false;

    function item(l: any) {
      const type = typeof l;
      if (l == null) void 0;
      else if ("string" === type) {
        if (!e) parseClass(l);
        else e.appendChild(document.createTextNode(l));
      } else if (
        "number" === type ||
        "boolean" === type ||
        l instanceof Date ||
        l instanceof RegExp
      ) {
        (e as Node).appendChild(document.createTextNode(l.toString()));
      } else if (Array.isArray(l)) {
        for (let i = 0; i < l.length; i++) item(l[i]);
      } else if (l instanceof Element) {
        r.insert(e as Element, l, undefined, multiExpression ? null : undefined);
      } else if ("object" === type) {
        let dynamic = false;
        for (const k in l) {
          if (typeof l[k] === "function" && k !== "ref" && k.slice(0, 2) !== "on") {
            r.dynamicProperty(l, k);
            dynamic = true;
          }
        }
        dynamic
          ? r.spread(e as Element, l, e instanceof SVGElement, !!args.length)
          : r.assign(e as Element, l, e instanceof SVGElement, !!args.length);
      } else if ("function" === type) {
        if (!e) {
          let props: Props | undefined,
            next = args[0];
          if (
            next == null ||
            (typeof next === "object" && !Array.isArray(next) && !(next instanceof Element))
          )
            props = args.shift();
          props || (props = {});
          props.children = (args.length > 1 ? args : args[0]) || props.children;
          for (const k in props) {
            if (typeof props[k] === "function" && !props[k].length) r.dynamicProperty(props, k);
          }
          e = r.createComponent(l, props);
          args = [];
        } else r.insert(e as Element, l, undefined, multiExpression ? null : undefined);
      }
    }
    typeof args[0] === "string" && detectMultiExpression(args);
    while (args.length) item(args.shift());
    return e as ExpandableNode;

    function parseClass(string: string) {
      // Our minimal parser doesn’t understand escaping CSS special
      // characters like `#`. Don’t use them. More reading:
      // https://mathiasbynens.be/notes/css-escapes .

      const m = string.split(/([\.#]?[^\s#.]+)/);
      if (/^\.|#/.test(m[1])) e = document.createElement("div");
      for (let i = 0; i < m.length; i++) {
        const v = m[i],
          s = v.substring(1, v.length);
        if (!v) continue;
        if (!e)
          e = r.SVGElements.has(v)
            ? document.createElementNS("http://www.w3.org/2000/svg", v)
            : document.createElement(v);
        else if (v[0] === ".") e.classList.add(s);
        else if (v[0] === "#") e.setAttribute("id", s);
      }
    }
    function detectMultiExpression(list: any[]) {
      for (let i = 1; i < list.length; i++) {
        if (typeof list[i] === "function") {
          multiExpression = true;
          return;
        } else if (Array.isArray(list[i])) {
          detectMultiExpression(list[i]);
        }
      }
    }
  }

  return h;
}
