import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeConfigFileAtomic } from "./config-file.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("atomic config file writes", () => {
    it("creates a private config without leaving temporary files", () => {
        const directory = createTemporaryDirectory();
        const configPath = path.join(directory, "nested", "config.yaml");

        const result = writeConfigFileAtomic(configPath, "general: {}\n");

        expect(result).toEqual({ path: configPath, backupPath: undefined });
        expect(fs.readFileSync(configPath, "utf8")).toBe("general: {}\n");
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.readdirSync(path.dirname(configPath))).toEqual(["config.yaml"]);
    });

    it("preserves permissions and keeps the immediately previous version as a backup", () => {
        const directory = createTemporaryDirectory();
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "port: 6727\n", { mode: 0o640 });

        const result = writeConfigFileAtomic(configPath, "port: 7788\n", { backup: true });

        expect(result.backupPath).toBe(`${fs.realpathSync(configPath)}.bak`);
        expect(fs.readFileSync(configPath, "utf8")).toBe("port: 7788\n");
        expect(fs.readFileSync(`${configPath}.bak`, "utf8")).toBe("port: 6727\n");
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o640);
    });

    it.runIf(process.platform !== "win32")(
        "updates a symlink target without replacing the link",
        () => {
            const directory = createTemporaryDirectory();
            const targetPath = path.join(directory, "real-config.yaml");
            const linkPath = path.join(directory, "config.yaml");
            fs.writeFileSync(targetPath, "port: 6727\n", "utf8");
            fs.symlinkSync(targetPath, linkPath);

            const result = writeConfigFileAtomic(linkPath, "port: 7788\n", { backup: true });

            expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
            expect(fs.readFileSync(targetPath, "utf8")).toBe("port: 7788\n");
            expect(fs.readFileSync(`${targetPath}.bak`, "utf8")).toBe("port: 6727\n");
            expect(result.path).toBe(fs.realpathSync(targetPath));
        },
    );
});

function createTemporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-file-"));
    temporaryDirectories.push(directory);
    return directory;
}
