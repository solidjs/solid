const API = "/api/messages";

export const sendMessage = async text => {
  "use server";
  await fetch(API, { method: "POST", body: text });
};

export const label = "chat";
