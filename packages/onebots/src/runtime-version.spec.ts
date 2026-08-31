import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import {
    inspectNodeRuntime,
    MINIMUM_NODE_MAJOR,
    unsupportedNodeRuntimeMessage,
} from "./runtime-version.js";

describe("Node.js runtime contract", () => {
    it.each([
        ["23.11.1", false, 23],
        ["v24.0.0", true, 24],
        ["25.1.0-pre", true, 25],
    ] as const)("classifies %s", (version, supported, major) => {
        expect(inspectNodeRuntime(version)).toEqual({ supported, version, major });
    });

    it("rejects malformed versions with an actionable message", () => {
        const runtime = inspectNodeRuntime("nightly");

        expect(runtime).toEqual({ supported: false, version: "nightly", major: undefined });
        expect(unsupportedNodeRuntimeMessage(runtime)).toContain(
            `OneBots 需要 Node.js >=${MINIMUM_NODE_MAJOR}`,
        );
    });

    it("reports the detected version when an older runtime is unsupported", () => {
        expect(unsupportedNodeRuntimeMessage(inspectNodeRuntime("v22.14.0"))).toBe(
            "当前 Node.js v22.14.0 不受支持；OneBots 需要 Node.js >=24",
        );
    });

    it("keeps published and workspace requirements aligned with the runtime guard", () => {
        const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
            engines: { node: string };
        };
        const publishedPackage = JSON.parse(
            fs.readFileSync("packages/onebots/package.json", "utf8"),
        ) as { engines: { node: string } };

        expect(rootPackage.engines.node).toBe(`>=${MINIMUM_NODE_MAJOR}`);
        expect(publishedPackage.engines.node).toBe(`>=${MINIMUM_NODE_MAJOR}`);
        expect(fs.readFileSync(".node-version", "utf8").trim()).toBe(String(MINIMUM_NODE_MAJOR));
        expect(fs.readFileSync(".nvmrc", "utf8").trim()).toBe(String(MINIMUM_NODE_MAJOR));
    });
});
