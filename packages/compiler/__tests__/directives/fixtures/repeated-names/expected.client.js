import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
const makePublishSaver = function makePublishSaver() {
  const submit = createServerReference_1("submit-f3b916ee");
  return submit;
};
const makeDraftSaver = function makeDraftSaver() {
  const submit = createServerReference_1("submit-f3b916ee-1");
  return submit;
};
export { makeDraftSaver };
export { makePublishSaver };
