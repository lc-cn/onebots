import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseServeOptions } from "./serve-options.js";
vi.mock("../service-host.js", () => ({
    createDefaultServiceHost: () => {
        throw new Error("parsing must not fork a native identity helper");
    },
}));

describe("来源只由可信 serve 参数解析", () => {
    it("将显式目录传给 host，拒绝重复和缺失参数", () => {
        expect(
            parseServeOptions(["--authority-dir", "outside", "--data-dir", "data"]),
        ).toMatchObject({
            authorityDirectory: path.resolve("outside"),
            workspace: path.resolve("data"),
        });
        expect(() => parseServeOptions(["--authority-dir"])).toThrow();
        expect(() => parseServeOptions(["--authority-dir", "a", "--authority-dir", "b"])).toThrow();
    });
    it("缺省使用稳定用户 state 目录，工作区环境不能改变 authority 来源", () => {
        const a = parseServeOptions([], { ONEBOTS_WORKSPACE: path.resolve("first") });
        const b = parseServeOptions([], { ONEBOTS_WORKSPACE: path.resolve("second") });
        expect(a?.authorityDirectory).toEqual(b?.authorityDirectory);
        expect(a?.authorityDirectory).not.toContain("first");
    });
});
