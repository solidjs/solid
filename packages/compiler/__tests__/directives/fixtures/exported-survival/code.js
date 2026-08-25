import { buildConfig } from "./config";

export const config = buildConfig();

export const push = async event => {
  "use server";
  return fetch(config.endpoint, { method: "POST", body: event });
};
