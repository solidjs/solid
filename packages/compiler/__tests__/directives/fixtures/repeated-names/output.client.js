import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
const makePublishSaver = function makePublishSaver() {
	const submit = createServerReference_1("makePublishSaver.submit-f3b916ee");
	return submit;
};
const makeDraftSaver = function makeDraftSaver() {
	const submit = createServerReference_1("makeDraftSaver.submit-f3b916ee");
	return submit;
};
export { makeDraftSaver };
export { makePublishSaver };
