/** 管理端主连接允许配置同步等较大 JSON 消息，但仍限制单条入站载荷。 */
export const MANAGEMENT_WEBSOCKET_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

/** 终端输入只需要较小消息，避免单个连接占用过多内存。 */
export const TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES = 1024 * 1024;
