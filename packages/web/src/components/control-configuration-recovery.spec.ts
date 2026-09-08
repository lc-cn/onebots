import { describe, expect, it, vi } from "vitest";
import { ControlRequestError, type ControlConfigurationOperation } from "@onebots/core/control";
import {
    resolveConfigurationConflict,
    readConfigurationTracking,
    matchingConfigurationTracking,
} from "./control-configuration-recovery.js";

describe("configuration submit recovery", () => {
    it("另一标签页已替换存储记录时不得清除其操作", () => {
        const a = "a".repeat(36), b = "b".repeat(36);
        expect(matchingConfigurationTracking({operationId: a, receiptId: a}, JSON.stringify({operationId: b, receiptId: b}))).toEqual({});
    });
    const submitted = { operationId: "op", receiptId: "receipt" };
    const fixture = () => ({
        error: new ControlRequestError(409, "conflict"),
        newlySubmitted: true,
        submitted,
        current: () => ({ ...submitted }),
        lookup: vi.fn<() => Promise<ControlConfigurationOperation>>(async () => {
            throw new ControlRequestError(404, "missing");
        }),
    });
    it("新提交409且原ID明确不存在时解除，不生成新请求", async () => {
        const input = fixture();
        expect(await resolveConfigurationConflict(input)).toEqual({ clear: true });
        expect(input.lookup).toHaveBeenCalledWith("op");
        expect(input.lookup).toHaveBeenCalledTimes(1);
    });
    it("超时、400或查询结果未知均保留原ID", async () => {
        for (const error of [new Error("timeout"), new ControlRequestError(400, "bad")]) {
            const input = fixture();
            input.error = error as ControlRequestError;
            expect(await resolveConfigurationConflict(input)).toEqual({ clear: false });
            expect(input.lookup).not.toHaveBeenCalled();
        }
        const input = fixture();
        input.lookup.mockRejectedValue(new ControlRequestError(400, "corrupt"));
        expect(await resolveConfigurationConflict(input)).toEqual({ clear: false });
    });
    it("不同receipt的已有操作保留历史，不能误认为未执行", async () => {
        const input = fixture();
        const existing: ControlConfigurationOperation = {
            id: "op",
            validationId: "other",
            status: "succeeded",
            phase: "completed",
            recoveryRequired: false,
        };
        input.lookup.mockResolvedValue(existing);
        expect(await resolveConfigurationConflict(input)).toEqual({ clear: false, existing });
    });
    it("恢复出来的旧请求、身份已变化或查询期间身份变化不能解除", async () => {
        const restored = fixture();
        restored.newlySubmitted = false;
        expect((await resolveConfigurationConflict(restored)).clear).toBe(false);
        const changed = fixture();
        changed.current = () => ({ operationId: "new", receiptId: "receipt" });
        expect((await resolveConfigurationConflict(changed)).clear).toBe(false);
        const raced = fixture();
        let current = { ...submitted };
        raced.current = () => current;
        raced.lookup.mockImplementation(async () => {
            current = { operationId: "new", receiptId: "new" };
            throw new ControlRequestError(404, "missing");
        });
        expect((await resolveConfigurationConflict(raced)).clear).toBe(false);
    });
    it("浏览器恢复仅采用合法非秘密标识", () => {
        const id = "a".repeat(36);
        expect(
            readConfigurationTracking(
                JSON.stringify({
                    draftId: id,
                    operationId: id,
                    receiptId: id,
                    token: "synthetic-secret",
                }),
            ),
        ).toEqual({ draftId: id, operationId: id, receiptId: id });
        expect(
            readConfigurationTracking(
                JSON.stringify({ draftId: 12, operationId: "bad", receiptId: id }),
            ),
        ).toEqual({});
    });
});
