export type ProtocolErrorKind = "transport" | "protocol" | "validation";

export interface ProtocolErrorOptions {
    protocol: string;
    operation: string;
    kind: ProtocolErrorKind;
    message: string;
    httpStatus?: number;
    code?: string | number;
    response?: unknown;
    cause?: unknown;
}

/** 协议调用在传输、协议响应或参数验证阶段产生的结构化错误。 */
export class ProtocolError extends Error {
    readonly protocol: string;
    readonly operation: string;
    readonly kind: ProtocolErrorKind;
    readonly httpStatus?: number;
    readonly code?: string | number;
    readonly response?: unknown;

    constructor(options: ProtocolErrorOptions) {
        super(options.message, { cause: options.cause });
        this.name = "ProtocolError";
        this.protocol = options.protocol;
        this.operation = options.operation;
        this.kind = options.kind;
        this.httpStatus = options.httpStatus;
        this.code = options.code;
        this.response = options.response;
    }
}
