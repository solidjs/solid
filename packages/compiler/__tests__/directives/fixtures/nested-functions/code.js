function helper() {
  const inner = () => {
    "use server";
    return 1;
  };
  return inner;
}

export const run = async () => {
  "use server";
  return helper();
};
