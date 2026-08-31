import type { MaybeArray } from "./types.js";

export namespace Message {
    /** 协议无关消息段；具体协议可以收窄 type 与 data。 */
    export interface Segment {
        type: string;
        data: Record<string, unknown>;
    }

    /** 文本快捷形式或协议无关消息段；适配器负责转换为目标协议的载荷。 */
    export type Content = string | MaybeArray<Segment>;

    /** 将文本快捷形式和单段消息统一为段数组，供要求数组载荷的协议复用。 */
    export function toSegments(content: Content): Segment[] {
        if (typeof content === "string") {
            return [{ type: "text", data: { text: content } }];
        }
        return Array.isArray(content) ? content : [content];
    }
    /** 核心包不猜测协议响应；具体 Adapter 应覆盖为自己的返回类型。 */
    export type Ret = unknown;
    export type SceneType = "private" | "group" | "channel";
}
