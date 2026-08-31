import { timingSafeEqual } from "node:crypto";
import { MatrixError } from "./errors.js";
import type { MatrixHttpResponse } from "./types.js";

export const MATRIX_JSON_HEADERS = Object.freeze({ "content-type": "application/json" });

export function matrixJsonResponse(
    status: number,
    body: Record<string, unknown>,
): MatrixHttpResponse {
    return { status, headers: MATRIX_JSON_HEADERS, body };
}

export function matrixErrorResponse(
    status: number,
    errcode: string,
    error: string,
): MatrixHttpResponse {
    return matrixJsonResponse(status, { errcode, error });
}

export function toFetchResponse(response: MatrixHttpResponse): Response {
    return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: response.headers,
    });
}

export function verifyHomeserverToken(
    authorization: string | undefined,
    queryToken: string | undefined,
    expected: string,
): void {
    const bearer = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
    if (!bearer) {
        throw new MatrixError("Matrix AppService 请求缺少 hs_token", {
            code: "M_MISSING_TOKEN",
            status: 401,
        });
    }
    if (bearer && queryToken && !safeEqual(bearer, queryToken)) {
        throw new MatrixError("Authorization 与 access_token 不一致", {
            code: "M_FORBIDDEN",
            status: 403,
        });
    }
    if (!safeEqual(bearer, expected)) {
        throw new MatrixError("Matrix AppService hs_token 无效", {
            code: "M_FORBIDDEN",
            status: 403,
        });
    }
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
