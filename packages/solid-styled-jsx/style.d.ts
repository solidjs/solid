declare function JSXStyle(props: any): void;
declare function flush(): [string, string][]
declare global {
  namespace JSX {
    interface StyleHTMLAttributes<T> {
      jsx?: boolean;
      global?: boolean;
      dynamic?: boolean;
    }
  }
}

export default JSXStyle;
export { flush };
