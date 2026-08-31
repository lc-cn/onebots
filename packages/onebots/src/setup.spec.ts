import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import { runSetup } from "./setup.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function temporaryConfigPath(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-setup-"));
    temporaryDirectories.push(directory);
    return path.join(directory, "config.yaml");
}

describe("setup workflow", () => {
    it("writes a secure first-run configuration without unloaded protocol references", async () => {
        const configPath = temporaryConfigPath();
        const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        await runSetup(configPath);

        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config.general).toEqual({});
        expect(config.access_token).toMatch(/^[a-f0-9]{64}$/u);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.existsSync(path.join(path.dirname(configPath), "data"))).toBe(true);
        const renderedOutput = output.mock.calls.map(call => String(call[0])).join("");
        expect(renderedOutput).toContain("access_token");
        expect(renderedOutput).not.toContain(String(config.access_token));
    });

    it("does not overwrite an existing config in a non-interactive session", async () => {
        const configPath = temporaryConfigPath();
        fs.writeFileSync(configPath, "port: 7000\n", "utf8");

        await runSetup(configPath);

        expect(fs.readFileSync(configPath, "utf8")).toBe("port: 7000\n");
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
    });

    it("atomically backs up an existing config before a forced update", async () => {
        const configPath = temporaryConfigPath();
        const original = "port: 7000\nlog_level: info\ntimeout: 30\ngeneral: {}\n";
        fs.writeFileSync(configPath, original, { mode: 0o640 });

        await runSetup(configPath, { force: true });

        expect(fs.readFileSync(`${configPath}.bak`, "utf8")).toBe(original);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o640);
        expect(yaml.load(fs.readFileSync(configPath, "utf8"))).toMatchObject({
            port: 7000,
            general: {},
        });
    });
});
