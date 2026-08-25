import { track } from "./analytics";

export const handlers = {
  save: function saveRecord(data) {
    "use server";
    return track("save", data);
  },
  drop: function (id) {
    "use server";
    return track("drop", id);
  }
};
