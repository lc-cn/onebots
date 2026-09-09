import { afterEach, describe, expect, it, vi } from "vitest";
import { runManagerDoctor } from "../manager-doctor.js";
import { managerDoctorCommand } from "./manager-doctor-command.js";
vi.mock("../manager-doctor.js", () => ({ runManagerDoctor: vi.fn() }));
vi.mock("./command-runner.js", () => ({ CommandRunner: () => null }));
afterEach(() => vi.mocked(runManagerDoctor).mockReset());
describe("新 doctor CLI", () => {
    it("--fix JSON 是单一失败报告，不调用任何诊断写入路径", async () => {
        const result = await managerDoctorCommand({ fix: true, json: true });
        expect(result.exitCode).toBe(1);
        expect(result.raw).toBe(true);
        expect(JSON.parse(result.output!).checks[0].message).toContain("不执行 --fix");
        expect(runManagerDoctor).not.toHaveBeenCalled();
    });
    it("传递新目标与严格模式，保留未验证警告", async () => {
        vi.mocked(runManagerDoctor).mockResolvedValue({
            schemaVersion: 1,
            checks: [{ id: "database", status: "warn", message: "未验证" }],
            exitCode: 1,
        });
        const result = await managerDoctorCommand({
            dataDir: "/data",
            strict: true,
            system: false,
        });
        expect(runManagerDoctor).toHaveBeenCalledExactlyOnceWith(
            { dataDir: "/data", strict: true, system: false, fix: false },
            undefined,
        );
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("未验证");
    });
    it("异常转为脱敏单一 JSON 失败报告", async () => {
        vi.mocked(runManagerDoctor).mockRejectedValue(new Error("synthetic-secret"));
        const result = await managerDoctorCommand({ json: true });
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.output!).schemaVersion).toBe(1);
        expect(result.output).not.toContain("synthetic-secret");
    });
    it("帮助导入不诊断，旧运行选项不再接受", async () => {
        const route = await import("../commands/doctor.js");
        const defaults = { system: false, fix: false, json: false, strict: false };
        expect(route.options.safeParse({ ...defaults, dataDir: "/data" }).success).toBe(true);
        for (const key of ["config", "register", "protocol"])
            expect(route.options.safeParse({ ...defaults, [key]: "old" }).success).toBe(false);
        expect(runManagerDoctor).not.toHaveBeenCalled();
    });
});
