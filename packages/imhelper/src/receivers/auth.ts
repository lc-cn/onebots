import type { IncomingHttpHeaders } from "node:http";

/** 从 Query 或标准 Bearer Header 中读取接收端令牌。 */
export function readReceiverToken(
    requestUrl: string | undefined,
    headers: IncomingHttpHeaders,
): string | undefined {
    const authorization = headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
        return authorization.slice("Bearer ".length);
    }
    return (
        new URL(requestUrl ?? "/", "http://localhost").searchParams.get("access_token") ?? undefined
    );
}
