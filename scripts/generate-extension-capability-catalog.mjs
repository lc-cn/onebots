import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const adaptersRoot = path.join(repositoryRoot, "adapters");
const outputPath = path.join(
    repositoryRoot,
    "packages",
    "onebots",
    "src",
    "extension-capability-catalog.json",
);

async function buildCatalog() {
    const adapterDirectories = fs
        .readdirSync(adaptersRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith("adapter-"))
        .map(entry => entry.name)
        .filter(name => name !== "adapter-mock")
        .sort();
    const adapters = {};

    for (const directory of adapterDirectories) {
        const platform = directory.slice("adapter-".length);
        const packageDirectory = path.join(adaptersRoot, directory);
        const packageJson = JSON.parse(
            fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"),
        );
        const capabilityPath = path.join(packageDirectory, "lib", "capabilities.js");
        if (!fs.existsSync(capabilityPath)) {
            throw new Error(
                `缺少 ${platform} 的构建产物 ${capabilityPath}，请先运行 pnpm build:rest`,
            );
        }
        const exports = await import(
            `${pathToFileURL(capabilityPath).href}?catalog=${fs.statSync(capabilityPath).mtimeMs}`
        );
        const manifest = Object.values(exports).find(
            value =>
                value &&
                typeof value === "object" &&
                value.version === 1 &&
                value.actions &&
                value.events &&
                value.segments &&
                value.transports,
        );
        if (!manifest) throw new Error(`${platform} 没有导出能力清单`);
        adapters[platform] = {
            packageName: packageJson.name,
            packageVersion: packageJson.version,
            manifest,
        };
    }

    return `${JSON.stringify({ schemaVersion: 1, adapters }, null, 2)}\n`;
}

const content = await buildCatalog();
if (process.argv.includes("--check")) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    if (current !== content) {
        console.error("扩展能力目录已过期，请先构建适配器，再运行 pnpm catalog:capabilities");
        process.exitCode = 1;
    }
} else {
    fs.writeFileSync(outputPath, content);
    console.log(`已更新扩展能力目录: ${path.relative(repositoryRoot, outputPath)}`);
}
