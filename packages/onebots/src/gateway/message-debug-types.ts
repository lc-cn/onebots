export interface MessageDebugEntry {
    /** 单调递增序号，供前端去重/排序 */
    seq: number;
    /** 记录时间（毫秒） */
    time: number;
    /** inbound：适配器收到的原始 CommonEvent；outbound：协议转换后发往客户端的数据 */
    direction: "inbound" | "outbound";
    platform: string;
    account_id: string;
    /** outbound 时为协议名（如 onebot），inbound 为空 */
    protocol?: string;
    /** outbound 时为协议版本（如 v11），inbound 为空 */
    version?: string;
    /** inbound 为 CommonEvent 对象；outbound 为协议 dispatch 抛出的 JSON 字符串或对象 */
    payload: unknown;
}

export interface MessageDebugClearReceipt {
    clearedCount: number;
    clearedThroughSeq: number;
}
