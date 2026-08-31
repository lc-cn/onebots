import { describe, expect, it } from "vitest";
import { inspectServiceNodeRuntime } from "./doctor-service-runtime.js";

describe("doctor service Node runtime", () => {
    it("接受满足要求的服务 Node", () => {
        expect(inspectServiceNodeRuntime("/opt/node24/bin/node", () => "v24.8.0\n")).toEqual({
            supported: true,
            check: {
                name: "service-node",
                level: "ok",
                message: "服务 Node.js v24.8.0（要求 >=24）：/opt/node24/bin/node",
            },
        });
    });

    it("拒绝仍存在但版本过旧的服务 Node", () => {
        expect(inspectServiceNodeRuntime("/opt/node22/bin/node", () => "v22.14.0")).toEqual({
            supported: false,
            check: {
                name: "service-node",
                level: "error",
                message:
                    "服务定义 /opt/node22/bin/node：当前 Node.js v22.14.0 不受支持；OneBots 需要 Node.js >=24",
            },
        });
    });

    it("不把执行异常中的环境内容写入诊断", () => {
        const inspection = inspectServiceNodeRuntime("/broken/node", () => {
            throw new Error("spawn failed with NODE_AUTH_TOKEN=secret-token");
        });

        expect(inspection).toEqual({
            supported: false,
            check: {
                name: "service-node",
                level: "error",
                message: "服务 Node.js 无法执行: /broken/node",
            },
        });
        expect(inspection.check.message).not.toContain("secret-token");
    });
});
