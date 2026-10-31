/** esbuild uses native paths; artifact labels and calibration use portable ones. */
export const portablePath = path => path.replaceAll("\\", "/");
export function calibrationTarget(path, file) {
  return portablePath(path).endsWith(`/src/core/${file}`);
}
export function sourceLabel(path, root) {
  const file = portablePath(path);
  const prefix = portablePath(root) + "/";
  return file.startsWith(prefix) ? "SIGNALS/" + file.slice(prefix.length) : file;
}
