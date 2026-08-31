import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeConfigStateTracker } from "./runtime-config-state.js";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("runtime config state", () => {
    it("detects an external file change and returns to sync only after it is marked applied", () => {
        const file = createConfig("access_token: first\n");
        const tracker = new RuntimeConfigStateTracker(file);

        expect(tracker.inspect()).toMatchObject({ status: "in_sync" });

        fs.writeFileSync(file, "access_token: second\n");
        expect(tracker.inspect()).toMatchObject({
            status: "drifted",
            message: "磁盘配置与当前进程最近应用的版本不一致",
        });

        tracker.markApplied();
        expect(tracker.inspect()).toMatchObject({ status: "in_sync" });
    });

    it("reports an unreadable source without exposing a fingerprint", () => {
        const file = createConfig("general: {}\n");
        const tracker = new RuntimeConfigStateTracker(file);
        fs.rmSync(file);

        const state = tracker.inspect();
        expect(state).toMatchObject({
            status: "unavailable",
            message: "无法读取已应用快照或当前配置文件",
        });
        expect(Object.keys(state).sort()).toEqual(["appliedAt", "message", "status"]);
    });
});

function createConfig(content: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-state-"));
    directories.push(directory);
    const file = path.join(directory, "config.yaml");
    fs.writeFileSync(file, content, { mode: 0o600 });
    return file;
}
