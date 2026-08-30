// Two same-named bindings in sibling scopes: identity keying deduplicates by
// file + NAME, so the second `submit` takes the ordinal suffix. The ordinal
// is document order among same-name functions only — reordering unrelated
// functions must not re-point either id (solidjs/solid#3109, #3120).
export function makeDraftSaver() {
  const submit = async data => {
    "use server";
    return ["draft", data];
  };
  return submit;
}

export function makePublishSaver() {
  const submit = async data => {
    "use server";
    return ["publish", data];
  };
  return submit;
}
