import { css, CSSAttribute } from "goober";
import { assignProps, createContext, useContext } from "solid-js";
import { spread, createComponent } from "solid-js/dom";

export { css, glob, extractCss } from "goober";

const ThemeContext = createContext();

export function ThemeProvider<T extends { theme: any; children?: any }>(props: T) {
  return createComponent(ThemeContext.Provider, {
    value: props.theme,
    get children() {
      return props.children;
    }
  });
}

export function useTheme() {
  return useContext(ThemeContext);
}

type StyledTemplateArgs<T> = [
  CSSAttribute | TemplateStringsArray | string | ((props: T) => CSSAttribute | string),
  ...Array<string | number | ((props: T) => CSSAttribute | string | number | undefined)>
];

export function styled<T extends keyof JSX.IntrinsicElements>(tag: T | ((props: any) => any)) {
  return <P>(...args: StyledTemplateArgs<P & { theme?: any; className?: any }>) => {
    return (
      props: P & JSX.IntrinsicElements[T] & { theme?: any; className?: any }
    ): JSX.Element => {
      const newProps = assignProps({}, props);
      props.theme = useContext(ThemeContext);
      Object.defineProperty(newProps, "className", {
        get() {
          const pClassName = props.className,
            append = "className" in props && /^go[0-9]+/.test(pClassName!);

          // Call `css` with the append flag and pass the props
          let className = css.apply(
            { target: this.target, o: append, p: props },
            args as [any, ...any[]]
          );

          return [pClassName, className].filter(Boolean).join(" ");
        },
        configurable: true,
        enumerable: true
      });

      let el;
      if (typeof tag === "function") {
        el = tag(newProps);
      } else {
        el = document.createElement(tag);
        spread(el, newProps);
      }

      return el;
    };
  };
}
