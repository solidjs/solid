import { css, setup as gooberSetup } from "goober";
import { mergeProps, splitProps, createContext, useContext, createComponent } from "solid-js";
import { spread, ssr, ssrSpread, isServer } from "solid-js/web";
export { css, glob, extractCss, keyframes } from "goober";
export function setup(prefixer) {
  gooberSetup(null, prefixer);
}
const ThemeContext = createContext();
export function ThemeProvider(props) {
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
export function styled(tag) {
  let _ctx = this || {};
  return (...args) => {
    return props => {
      const theme = useContext(ThemeContext);
      const clone = mergeProps(props, {
        get className() {
          const pClassName = props.className,
            append = "className" in props && /^go[0-9]+/.test(pClassName);
          // Call `css` with the append flag and pass the props
          let className = css.apply({ target: this.target, o: append, p: clone, g: _ctx.g }, args);
          return [pClassName, className].filter(Boolean).join(" ");
        },
        theme
      });
      const [local, newProps] = splitProps(clone, ["as"]);
      const createTag = local.as || tag;
      let el;
      if (typeof createTag === "function") {
        el = createTag(newProps);
      } else if (isServer) {
        const [local, others] = splitProps(newProps, ["children"]);
        el = ssr(
          [`<${createTag} `, ">", `</${createTag}>`],
          ssrSpread(others),
          local.children || ""
        );
      } else {
        el = document.createElement(createTag);
        spread(el, newProps);
      }
      return el;
    };
  };
}
export function createGlobalStyles() {
  const fn = styled.call({ g: 1 }, 'div').apply(null, arguments);
  return function GlobalStyles(props) {
    fn(props);
    return null;
  };
}
