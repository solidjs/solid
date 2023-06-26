import { dirname, join } from "path";
import { writeFile, mkdir } from "fs";

async function write() {
  const server = (await import(join("file://", process.argv[2]))).default;
  const res = await server({ url: process.argv[4] });
  mkdir(dirname(process.argv[3]), { recursive: true }, () =>
    writeFile(process.argv[3], res, () => process.exit(0))
  );
}
write();
