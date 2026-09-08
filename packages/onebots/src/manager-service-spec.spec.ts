import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseManagerServiceSpec, buildManagerServiceArgs } from "./manager-service-spec.js";
function spec() {
    return {
        schemaVersion: 1 as const,
        runtimeKind: "control" as const,
        scope: "user" as const,
        workspace: path.resolve("workspace with 空格"),
        nodePath: path.resolve("node runtime/bin/node"),
        binPath: path.resolve("one bots/bin.js"),
        workingDirectory: path.resolve("run directory"),
        host: "127.0.0.1",
        port: 6727,
    };
}
describe("管理服务持久化目标契约", () => {
    it("保留绝对路径空格并生成固定serve argv，不夹带旧业务参数", () => {
        const input = spec();
        expect(parseManagerServiceSpec(input)).toEqual(input);
        const args = buildManagerServiceArgs(input);
        expect(args).toEqual([
            input.binPath,
            "serve",
            "--data-dir",
            input.workspace,
            "--host",
            "127.0.0.1",
            "--port",
            "6727",
        ]);
        for (const old of ["--service-runtime", "run", "-c", "-r", "-p", "-t"])
            expect(args).not.toContain(old);
        const copy = parseManagerServiceSpec(input);
        copy.port = 8000;
        expect(input.port).toBe(6727);
    });
    it("拒绝额外或缺失字段，旧ServiceSpec不可假装新契约", () => {
        for (const key of [
            "configPath",
            "adapters",
            "protocols",
            "applications",
            "token",
            "desired",
        ])
            expect(() => parseManagerServiceSpec({ ...spec(), [key]: "value" })).toThrow();
        for (const key of Object.keys(spec())) {
            const input: Record<string, unknown> = { ...spec() };
            delete input[key];
            expect(() => parseManagerServiceSpec(input)).toThrow();
        }
        expect(() => parseManagerServiceSpec({ ...spec(), runtimeKind: "run" })).toThrow();
        expect(() => parseManagerServiceSpec({ ...spec(), schemaVersion: 2 })).toThrow();
        expect(() => parseManagerServiceSpec({ ...spec(), scope: "global" })).toThrow();
    });
    it("拒绝相对路径和换行NUL，拒绝隐式端口转换", () => {
        for (const key of ["workspace", "nodePath", "binPath", "workingDirectory"])
            for (const value of [
                "relative",
                "",
                path.resolve("bad\npath"),
                path.resolve("bad\rpath"),
                path.resolve("bad\u0000path"),
            ])
                expect(() => parseManagerServiceSpec({ ...spec(), [key]: value })).toThrow();
        for (const port of [0, -1, 65536, 1.5, NaN, Infinity, "6727"])
            expect(() => parseManagerServiceSpec({ ...spec(), port })).toThrow();
        for (const host of [
            "",
            "--host",
            "http://localhost",
            "localhost:6727",
            "localhost\n",
            "bad host",
        ])
            expect(() => parseManagerServiceSpec({ ...spec(), host })).toThrow();
        for (const host of ["localhost", "0.0.0.0", "::1", "example.test"])
            expect(parseManagerServiceSpec({ ...spec(), host }).host).toBe(host);
    });
    it("拒绝getter、隐藏字段与Symbol，不执行自定义代码", () => {
        let read = false;
        expect(() =>
            parseManagerServiceSpec({
                ...spec(),
                get port() {
                    read = true;
                    return 6727;
                },
            }),
        ).toThrow();
        expect(read).toBe(false);
        const hidden = Object.defineProperty(spec(), "secret", { value: "private" });
        expect(() => parseManagerServiceSpec(hidden)).toThrow();
        expect(() => parseManagerServiceSpec({ ...spec(), [Symbol("secret")]: true })).toThrow();
    });
});
