import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { parseServiceRuntimeInvocation } from "./cli.js";

describe("internal service runtime", () => {
    it("parses isolated preflight options without exposing a public route", () => {
        expect(
            parseServiceRuntimeInvocation([
                "node",
                "onebots",
                "preflight",
                "-c",
                "config.yaml",
                "-r",
                "mock",
                "-p",
                "onebot-v11",
            ]),
        ).toEqual({
            command: "preflight",
            options: {
                configPath: path.resolve("config.yaml"),
                adapters: ["mock"],
                protocols: ["onebot-v11"],
            },
        });
    });
});
