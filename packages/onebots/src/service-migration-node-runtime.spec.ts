import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
    captureLegacyNodeRuntime,
    verifyLegacyNodeRuntime,
} from "./service-migration-node-runtime.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "retained-node-test-")));
    roots.push(root);
    const source = path.join(root, "source-node");
    const store = path.join(root, "store");
    fs.mkdirSync(store, { mode: 0o700 });
    return { root, source, store };
}

describe.skipIf(process.platform !== "darwin")("保留旧 Node 运行时", () => {
    it("删除原二进制后副本仍能执行，拒绝身份错属和篡改", async () => {
        const test = fixture();
        fs.copyFileSync(process.execPath, test.source);
        fs.chmodSync(test.source, 0o700);
        const receipt = await captureLegacyNodeRuntime(test.source, test.store, randomUUID());
        fs.unlinkSync(test.source);
        expect(receipt.version).toBe(process.version);
        expect(receipt.arch).toBe(process.arch);
        await verifyLegacyNodeRuntime(receipt);
        await expect(verifyLegacyNodeRuntime({ ...receipt, version: "v0.0.0" })).rejects.toThrow();
        const executable = path.join(receipt.tree.root, "node");
        fs.chmodSync(executable, 0o600);
        await expect(verifyLegacyNodeRuntime(receipt)).rejects.toThrow();
    }, 60_000);
    it("非原生可执行文件不能通过静态检查或被运行", async () => {
        const test = fixture();
        const marker = path.join(test.root, "executed");
        fs.writeFileSync(test.source, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
        await expect(
            captureLegacyNodeRuntime(test.source, test.store, randomUUID()),
        ).rejects.toThrow();
        expect(fs.existsSync(marker)).toBe(false);
        expect(fs.readdirSync(test.store)).toEqual([]);
    });
});
