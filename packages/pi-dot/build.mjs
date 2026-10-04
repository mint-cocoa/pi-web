import { copyFile, mkdir, readdir } from "node:fs/promises";
const target = new URL("./vendor/dot-client/", import.meta.url);
const source = new URL("../dot-client/", import.meta.url);
await mkdir(target, { recursive: true });
for (const name of await readdir(source)) {
  if (name.endsWith(".mjs") || name.endsWith(".d.mts")) {
    await copyFile(new URL(name, source), new URL(name, target));
  }
}
