import type { CommonTypes } from "onebots";
import { MockError } from "./errors.js";

/** 编译 Mock 明确支持的文本段；未声明能力不会退化为占位字符串。 */
export function compileMockMessage(message: ReadonlyArray<CommonTypes.Segment | string>): string {
    const content = message
        .map(segment => {
            if (typeof segment === "string") return segment;
            if (segment.type !== "text") {
                throw new MockError(`Mock 不支持消息段 ${segment.type}`, {
                    code: "MOCK_UNSUPPORTED_SEGMENT",
                    details: segment,
                });
            }
            const text = segment.data.text;
            if (typeof text !== "string")
                throw new MockError("Mock 文本段缺少 text", {
                    code: "MOCK_INVALID_TEXT_SEGMENT",
                    details: segment,
                });
            return text;
        })
        .join("");
    if (!content) throw new MockError("Mock 消息内容不能为空", { code: "MOCK_EMPTY_MESSAGE" });
    return content;
}
