import { getTriple, getList } from "./data";

const [first, second, third] = getTriple();
const [head, ...tail] = getList();

export const send = async () => {
  "use server";
  return first + third + tail.length;
};

export const keep = () => second;
