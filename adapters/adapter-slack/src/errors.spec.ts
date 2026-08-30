import {
    WebAPIFileUploadInvalidArgumentsError,
    WebAPIHTTPError,
    WebAPIPlatformError,
    WebAPIRateLimitedError,
    WebAPIRequestError,
} from "@slack/web-api";
import { SMWebsocketError } from "@slack/socket-mode";
import { describe, expect, it } from "vitest";
import { ErrorCategory } from "onebots";
import { SlackError } from "./errors.js";

describe("SlackError", () => {
    it("保留 Web API 平台错误码", () => {
        const error = SlackError.wrap(
            new WebAPIPlatformError({ ok: false, error: "channel_not_found" }),
            "conversations.info",
        );
        expect(error).toMatchObject({
            code: "SLACK_CHANNEL_NOT_FOUND",
            platformCode: "channel_not_found",
            operation: "conversations.info",
        });
    });

    it("区分 HTTP、限流与网络错误", () => {
        expect(SlackError.wrap(new WebAPIHTTPError(503, "Unavailable", {}))).toMatchObject({
            status: 503,
            category: ErrorCategory.NETWORK,
        });
        expect(SlackError.wrap(new WebAPIRateLimitedError(30))).toMatchObject({
            code: "SLACK_RATE_LIMITED",
            status: 429,
            details: { retry_after: 30 },
        });
        expect(SlackError.wrap(new WebAPIRequestError(new Error("offline")))).toMatchObject({
            code: "SLACK_API_ERROR",
            category: ErrorCategory.NETWORK,
        });
    });

    it("将文件参数与 Socket Mode 错误映射到稳定领域", () => {
        expect(
            SlackError.wrap(new WebAPIFileUploadInvalidArgumentsError("invalid upload")),
        ).toMatchObject({
            code: "SLACK_UPLOAD_ARGUMENTS_INVALID",
            category: ErrorCategory.VALIDATION,
        });
        expect(
            SlackError.wrap(
                new SMWebsocketError(new Error("closed")),
                "socket",
                "SLACK_SOCKET_ERROR",
            ),
        ).toMatchObject({
            code: "SLACK_SOCKET_ERROR",
            category: ErrorCategory.NETWORK,
            operation: "socket",
            details: { sdk_code: "slack_socket_mode_websocket_error" },
        });
    });
});
