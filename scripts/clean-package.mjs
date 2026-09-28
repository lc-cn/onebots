import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (!["ts", "lib", "web", "docs"].includes(mode)) {
    throw new Error("清理模式无效：使用 ts、lib、web 或 docs");
}

const directory = process.cwd();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = path.relative(root, directory).split(path.sep);
if (
    !fs.existsSync(path.join(directory, "package.json")) ||
    !(
        (relative.length === 2 && ["packages", "adapters"].includes(relative[0])) ||
        (relative.length === 3 && relative[0] === "protocols") ||
        (relative.length === 1 && relative[0] === "docs")
    )
) {
    throw new Error("只允许在 OneBots 子包中清理构建产物");
}
if (mode === "ts" || mode === "lib") {
    for (const entry of fs.readdirSync(directory)) {
        if (entry.endsWith(".tsbuildinfo")) {
            fs.rmSync(path.join(directory, entry), { force: true });
        }
    }
}
if (mode === "lib") fs.rmSync(path.join(directory, "lib"), { recursive: true, force: true });
if (mode === "web" || mode === "docs") {
    fs.rmSync(path.join(directory, "dist"), { recursive: true, force: true });
}
if (mode === "docs") {
    fs.rmSync(path.join(directory, ".vitepress", "cache"), { recursive: true, force: true });
}
