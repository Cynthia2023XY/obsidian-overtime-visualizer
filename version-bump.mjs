import { readFileSync, writeFileSync } from "node:fs";

/** npm 传入的新版本号 */
const nextVersion = process.env.npm_package_version;

if (!nextVersion) {
  throw new Error("Missing npm_package_version");
}

/** 当前插件清单 */
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

/** 插件版本兼容性映射 */
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

manifest.version = nextVersion;
versions[nextVersion] = manifest.minAppVersion;

writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);
