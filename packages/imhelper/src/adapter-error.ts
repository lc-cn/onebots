/** SDK 适配器未实现某个可选能力时的稳定结构化错误。 */
export class UnsupportedAdapterOperationError extends Error {
    readonly code = "IMHELPER_ADAPTER_OPERATION_UNSUPPORTED";

    constructor(readonly operation: string) {
        super(`Adapter operation is not supported: ${operation}`);
        this.name = "UnsupportedAdapterOperationError";
    }
}
