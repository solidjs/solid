"use strict";
"use server";

const secret = process.env.SECRET;

export const ping = async () => "pong" + secret;
