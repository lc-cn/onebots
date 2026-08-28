import type { MaybeArray } from "./types.js";

export namespace Message {
    /** 协议无关消息段；具体协议可以收窄 type 与 data。 */
    export interface Segment {
        type: string;
        data: Record<string, unknown>;
    }

    export type Content = MaybeArray<Segment>;
    /** 核心包不猜测协议响应；具体 Adapter 应覆盖为自己的返回类型。 */
    export type Ret = unknown;
    export type SceneType = "private" | "group" | "channel";
}
