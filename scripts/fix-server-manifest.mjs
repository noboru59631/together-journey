import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDirectory = path.join(repository, "dist", "server");
const sourceName = "__vite_rsc_assets_manifest.js";
const packagedName = "vinext-rsc-assets-manifest.js";
const sourcePath = path.join(serverDirectory, sourceName);
const indexPath = path.join(serverDirectory, "index.js");

if (existsSync(sourcePath) && existsSync(indexPath)) {
  copyFileSync(sourcePath, path.join(serverDirectory, packagedName));
  const index = readFileSync(indexPath, "utf8");
  writeFileSync(indexPath, index.replace(`./${sourceName}`, `./${packagedName}`));
}
