import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { controlSocket } from "./workspace.js";
afterEach(() => vi.restoreAllMocks());
it("短地址仍使用绝对路径", () => {
    expect(controlSocket("/tmp/ob")).toBe("/tmp/ob/.control/control.sock");
});
it.each(["a".repeat(140), "候选".repeat(25)])(
    "当前工作区的超长字节地址使用真实相对socket %s",
    name => {
        const root = path.join("/tmp", name);
        vi.spyOn(process, "cwd").mockReturnValue(root);
        expect(Buffer.byteLength(path.join(root, ".control/control.sock"))).toBeGreaterThan(103);
        expect(controlSocket(root)).toBe(".control/control.sock");
    },
);
it("不能将其他工作区的长地址偷偷连接到当前工作区", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/another");
    expect(() => controlSocket(`/tmp/${"b".repeat(140)}`)).toThrow("路径过长");
});
