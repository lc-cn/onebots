import { describe, expect, it } from "vitest";
import { requiresGatewayReconciliation } from "./host-http.js";

describe("gateway HTTP reconciliation gate", () => {
    it("启动操作已持久化但 driver 尚未创建子进程时不误判为冷恢复", () => {
        expect(
            requiresGatewayReconciliation(
                {
                    recoveryRequired: true,
                    operations: [
                        {
                            id: "starting",
                            action: "start",
                            status: "running",
                            startedAt: "2026-09-10T00:00:00.000Z",
                        },
                    ],
                },
                false,
            ),
        ).toBe(false);
    });

    it("仅对没有本轮运行操作和存活子进程的未知状态执行冷恢复", () => {
        expect(
            requiresGatewayReconciliation(
                {
                    recoveryRequired: true,
                    operations: [
                        {
                            id: "interrupted",
                            action: "start",
                            status: "failed",
                            startedAt: "2026-09-10T00:00:00.000Z",
                            finishedAt: "2026-09-10T00:00:01.000Z",
                        },
                    ],
                },
                false,
            ),
        ).toBe(true);
    });
});
