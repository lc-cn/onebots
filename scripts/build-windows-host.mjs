import { mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "native", "windows-host");
const target = path.join(root, "packages", "onebots", "lib", "native");
const requested = process.argv.slice(2);
const selected = requested.length ? requested : ["x64", "arm64"];
const goArchitectures = { x64: "amd64", arm64: "arm64" };

for (const architecture of selected) {
    const goarch = goArchitectures[architecture];
    if (!goarch) throw new Error(`不支持的 Windows 宿主架构: ${architecture}`);
    const directory = path.join(target, `win32-${architecture}`);
    mkdirSync(directory, { recursive: true });
    const output = path.join(directory, "onebots-windows-host.exe");
    const result = spawnSync(
        "go",
        ["build", "-trimpath", "-ldflags=-s -w", "-o", output, "./cmd/onebots-windows-host"],
        {
            cwd: source,
            env: { ...process.env, CGO_ENABLED: "0", GOOS: "windows", GOARCH: goarch },
            stdio: "inherit",
        },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
    const stat = statSync(output);
    if (!stat.isFile() || stat.size < 100_000)
        throw new Error(`Windows 宿主构建产物无效: ${output}`);
}
