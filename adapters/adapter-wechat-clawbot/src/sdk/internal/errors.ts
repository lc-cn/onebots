/** 网关或协议层可恢复/不可恢复故障 */
export class GatewayFault extends Error {
    readonly code: string;

    constructor(code: string, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "GatewayFault";
        this.code = code;
    }
}

/** 缺少回复所需的 context_token */
export class MissingReplyLaneFault extends GatewayFault {
    constructor(peerKey: string) {
        super(
            "MISSING_CONTEXT_TOKEN",
            `目标 "${peerKey}" 尚无可用 context_token：需对方先发言，或在发送参数里显式传入。`,
        );
        this.name = "MissingReplyLaneFault";
    }
}

/** 凭证被上游判定失效（常见 errcode -14） */
export class StaleCredentialFault extends GatewayFault {
    constructor(detail = "iLink 凭证失效，请重新登录") {
        super("SESSION_EXPIRED", detail);
        this.name = "StaleCredentialFault";
    }
}
