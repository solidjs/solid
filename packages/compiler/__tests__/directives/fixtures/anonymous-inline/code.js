import { register } from "./bus";

register(async event => {
  "use server";
  return event.type;
});
