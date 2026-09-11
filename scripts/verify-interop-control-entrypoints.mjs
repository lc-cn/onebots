import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = fs
    .readdirSync(path.join(root, "scripts"))
    .filter(name => /^interop-(?!harness).*\.mjs$/.test(name))
    .sort();
if (files.length !== 12) throw new Error(`互操作脚本数量异常：${files.length}`);

const forbidden = ["--service-runtime", "packages/onebots/lib/bin.js"];
const failures = files.flatMap(name => {
    const source = fs.readFileSync(path.join(root, "scripts", name), "utf8");
    return forbidden.filter(token => source.includes(token)).map(token => `${name}: ${token}`);
});
if (failures.length) throw new Error(`框架脚本仍调用旧网关入口：\n${failures.join("\n")}`);
process.stdout.write(`[onebots] ${files.length} 个框架脚本均使用常驻管理服务链\n`);
