import { describe, expect, it } from "vitest";
import { Adapter } from "./adapter.js";
import { UnsupportedAdapterOperationError } from "./adapter-error.js";

class MinimalAdapter extends Adapter<string> {
    readonly selfId = "bot";
}

describe("Adapter optional operation boundary", () => {
    it.each(["getUserList", "getGroupList", "getChannelList"] as const)(
        "不以空目录伪装未实现的 %s",
        async operation => {
            const adapter = new MinimalAdapter();

            await expect(adapter[operation]()).rejects.toEqual(
                expect.objectContaining({
                    name: "UnsupportedAdapterOperationError",
                    code: "IMHELPER_ADAPTER_OPERATION_UNSUPPORTED",
                    operation,
                }),
            );
        },
    );

    it("导出可精确识别的结构化错误类", () => {
        const error = new UnsupportedAdapterOperationError("sendMessage");

        expect(error).toBeInstanceOf(Error);
        expect(error.operation).toBe("sendMessage");
    });
});
