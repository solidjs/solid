// solid-refresh#77 reproduction: under `jsx: false` (the only mode
// vite-plugin-solid and this pass support) JSX is never rewritten, so a
// member-expression `ref` passes through verbatim for dom-expressions'
// own typeof-guarded ref handling. The crash in #77 only exists in the
// plugin's `jsx: true` extraction, which the native pass rejects.
export const InlineTextArea = props => {
  return <input ref={props.setRef} />;
};
