export const istanbulPragma = (
  <Show when={condition()}>
    {/* istanbul ignore next */}
    <div>Hello</div>
  </Show>
);

export const c8Pragma = (
  <Show when={condition()}>
    {/* c8 ignore next */}
    <div>Hello</div>
  </Show>
);
