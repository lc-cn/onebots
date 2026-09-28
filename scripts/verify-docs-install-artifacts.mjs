import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");
for (const name of ["install.sh", "install.ps1"]) {
    const source = fs.readFileSync(path.join(docs, "src", "public", name));
    const output = fs.readFileSync(path.join(docs, "dist", name));
    if (!source.equals(output)) throw new Error(`文档站安装脚本产物不匹配：${name}`);
}
