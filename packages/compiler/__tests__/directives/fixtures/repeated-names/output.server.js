import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const serverFunction_1 = registerServerReference_1("submit-f3b916ee", async (data) => {
	return ["publish", data];
});
const makePublishSaver = function makePublishSaver() {
	const submit = createServerReference_1(serverFunction_1);
	return submit;
};
const serverFunction_2 = registerServerReference_1("submit-f3b916ee-1", async (data) => {
	return ["draft", data];
});
const makeDraftSaver = function makeDraftSaver() {
	const submit = createServerReference_1(serverFunction_2);
	return submit;
};
export { makeDraftSaver };
export { makePublishSaver };
