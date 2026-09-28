import { describe, expect, it } from "vitest";
import { isGatewayAccountStatusMessage, safeAccountImageUrl } from "./contracts.js";

const message = {
    type: "gateway.account-status",
    protocolVersion: 1,
    controlInstanceId: "control-1",
    gatewayInstanceId: "gateway-1",
    accounts: [
        {
            platform: "mock",
            accountId: "bot",
            status: "online",
            protocols: [{ name: "onebot", version: "v11", status: "ready" }],
        },
    ],
};

describe("gateway account status projection", () => {
    it("accepts bounded protocol lifecycle statuses", () => {
        expect(isGatewayAccountStatusMessage(message)).toBe(true);
        expect(
            isGatewayAccountStatusMessage({
                ...message,
                accounts: [
                    {
                        ...message.accounts[0],
                        avatarUrl: "https://images.example.com/avatar.png",
                        platformIconUrl: "https://example.com/platform.png",
                    },
                ],
            }),
        ).toBe(true);
    });

    it("rejects unknown protocol status and additional fields", () => {
        expect(
            isGatewayAccountStatusMessage({
                ...message,
                accounts: [
                    {
                        ...message.accounts[0],
                        protocols: [{ name: "onebot", version: "v11", status: "unknown" }],
                    },
                ],
            }),
        ).toBe(false);
        expect(
            isGatewayAccountStatusMessage({
                ...message,
                accounts: [{ ...message.accounts[0], token: "must-not-cross-ipc" }],
            }),
        ).toBe(false);
    });

    it("rejects image addresses that can carry credentials or active content", () => {
        expect(safeAccountImageUrl("https://images.example.com/avatar.png")).toBe(true);
        const qqAvatar = "https://q1.qlogo.cn/g?b=qq&nk=10001&s=640";
        expect(safeAccountImageUrl(qqAvatar)).toBe(true);
        expect(
            isGatewayAccountStatusMessage({
                ...message,
                accounts: [{ ...message.accounts[0], avatarUrl: qqAvatar }],
            }),
        ).toBe(true);
        for (const url of [
            "data:image/svg+xml,<svg />",
            "http://images.example.com/avatar.png",
            "https://user:secret@example.com/avatar.png",
            "https://images.example.com/avatar.png#fragment",
            "javascript:alert(1)",
        ]) {
            expect(safeAccountImageUrl(url)).toBe(false);
            expect(
                isGatewayAccountStatusMessage({
                    ...message,
                    accounts: [{ ...message.accounts[0], avatarUrl: url }],
                }),
            ).toBe(false);
        }
    });
});
