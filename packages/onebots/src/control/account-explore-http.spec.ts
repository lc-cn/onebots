import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { ControlSendContext } from "@onebots/core/control";
import { respondControlAccountExplore } from "./account-explore-http.js";
import { AccountExploreError, ACCOUNT_EXPLORE_ERRORS } from "../gateway/account-explore-errors.js";

const context: ControlSendContext = {
    gatewayInstanceId: "00000000-0000-4000-8000-000000000001",
    configVersion: "a".repeat(64),
};

describe("账号查询 HTTP 失败回执", () => {
    it.each(Object.keys(ACCOUNT_EXPLORE_ERRORS) as (keyof typeof ACCOUNT_EXPLORE_ERRORS)[])(
        "%s 返回明确且不含平台敏感信息的失败原因",
        async code => {
            const request = new IncomingMessage(new Socket());
            request.method = "POST";
            const response = new ServerResponse(request);
            const end = vi.spyOn(response, "end").mockImplementation(() => response);
            const work = respondControlAccountExplore(
                {
                    context: () => context,
                    explore: async () => {
                        throw new AccountExploreError(code);
                    },
                },
                request,
                response,
                "/api/control/accounts/explore",
                true,
            );
            request.push(
                JSON.stringify({
                    expected: context,
                    account: "icqq/1689919782",
                    action: "groups",
                    kind: "group",
                }),
            );
            request.push(null);
            await work;
            expect(response.statusCode).toBe(ACCOUNT_EXPLORE_ERRORS[code].status);
            expect(JSON.parse(String(end.mock.calls[0][0]))).toEqual({
                code,
                message: ACCOUNT_EXPLORE_ERRORS[code].message,
            });
        },
    );
});
