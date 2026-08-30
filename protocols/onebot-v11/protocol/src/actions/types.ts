import type { Adapter, CommonTypes } from "onebots";

export type OneBotV11Params = Record<string, unknown>;

export type OneBotV11ActionHandler = (params: OneBotV11Params) => Promise<unknown>;

/**
 * 动作处理器只依赖协议转换所需的最小能力，避免反向持有整个 Protocol 实例。
 */
export interface OneBotV11ActionContext {
    readonly adapter: Adapter;
    readonly accountId: string;
    readonly resolveId: (id: string | number | CommonTypes.Id) => CommonTypes.Id;
    readonly parseMessage: (
        message: string | CommonTypes.Segment[],
        autoEscape: boolean,
    ) => CommonTypes.Segment[];
    readonly convertSegments: (
        segments: CommonTypes.Segment[],
    ) => { type: string; data: unknown }[];
    readonly convertMessageInfo: (message: Adapter.MessageInfo) => Record<string, unknown>;
    readonly clearMessageIds: () => void;
}
