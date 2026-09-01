import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServiceArgs, type ServiceSpec } from "./service-definition.js";
import {
    getWindowsUserServiceFiles,
    renderWindowsUserRunner,
    renderWindowsUserTaskXml,
} from "./windows-user-service-definition.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("Windows user service definition", () => {
    it("让任务计划直接执行 Node runner，不引入命令解释器", () => {
        const xml = renderWindowsUserTaskXml(
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\Users\\A&B\\OneBots %TEMP%\\runner.mjs",
        );

        expect(xml).toContain("<Command>C:\\Program Files\\nodejs\\node.exe</Command>");
        expect(xml).toContain(
            "<Arguments>&quot;C:\\Users\\A&amp;B\\OneBots %TEMP%\\runner.mjs&quot;</Arguments>",
        );
        expect(xml).not.toContain("cmd.exe");
        expect(xml).not.toContain("powershell.exe");
    });

    it("通过真实 Node 子进程无损恢复参数、工作目录和日志", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-user-runner & %TEMP% "));
        temporaryDirectories.push(root);
        const workingDirectory = path.join(root, 'work & 100% "quoted"');
        fs.mkdirSync(workingDirectory);
        const outputPath = path.join(root, "observed.json");
        const entryPath = path.join(root, 'entry & 100% "quoted".mjs');
        fs.writeFileSync(
            entryPath,
            `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
}));
console.log("用户 runner 标准输出");
console.error("用户 runner 错误输出");
`,
            "utf8",
        );
        const spec: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "config & %TOKEN%.yaml"),
            adapters: ["adapter & value", "%ADAPTER%", 'adapter "quoted"'],
            protocols: ["protocol & value"],
            nodePath: process.execPath,
            binPath: entryPath,
            workingDirectory,
        };
        const files = getWindowsUserServiceFiles(root);
        fs.writeFileSync(files.runner, renderWindowsUserRunner(spec, files.log), "utf8");

        const output = execFileSync(process.execPath, [files.runner], { encoding: "utf8" });
        const observed = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
            argv: string[];
            cwd: string;
        };

        expect(output).toBe("");
        expect(observed.argv).toEqual(buildServiceArgs(spec).slice(1));
        expect(observed.cwd).toBe(fs.realpathSync(workingDirectory));
        expect(fs.readFileSync(files.log, "utf8")).toBe(
            "用户 runner 标准输出\n用户 runner 错误输出\n",
        );
    });
});
