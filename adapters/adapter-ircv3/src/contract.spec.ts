import { rm } from "node:fs/promises";
import {
    assertAdapterCapabilities,
    assertAdapterCapabilityContract,
    BaseApp,
    SqliteDB,
} from "onebots";
import { describe, expect, it, vi } from "vitest";
import { Ircv3Adapter } from "./adapter.js";
import { describeIrcv3Capabilities, ircv3Capabilities } from "./capabilities.js";
import { Ircv3Client } from "./client.js";
import { normalizeIrcv3Config } from "./configuration.js";
import { ircv3Schema } from "./index.js";

describe("IRCv3 adapter contracts", () => {
    it("publishes a closed capability manifest and structured Web schema", () => {
        expect(() => assertAdapterCapabilities(ircv3Capabilities)).not.toThrow();
        // index.ts 在导入时调用 registerSchema()，其内会执行完整表单契约校验。
        expect(ircv3Schema.receive_mode).toMatchObject({ type: "string" });
    });

    it("requires a host only for managed connections and validates SASL atomically", () => {
        expect(() =>
            normalizeIrcv3Config({ account_id: "manual", nickname: "bot", receive_mode: "manual" }),
        ).not.toThrow();
        expect(() => normalizeIrcv3Config({ account_id: "direct", nickname: "bot" })).toThrow(
            /host/u,
        );
        expect(() =>
            normalizeIrcv3Config({
                account_id: "bad-sasl",
                nickname: "bot",
                receive_mode: "manual",
                sasl_password: "secret",
            }),
        ).toThrow(/sasl_mechanism/u);
        expect(() =>
            normalizeIrcv3Config({
                account_id: "bad-external",
                nickname: "bot",
                receive_mode: "manual",
                sasl_mechanism: "EXTERNAL",
                sasl_password: "ignored-secret",
            }),
        ).toThrow(/EXTERNAL/u);
        expect(() =>
            normalizeIrcv3Config({
                account_id: "malformed",
                nickname: "bot",
                receive_mode: "manual",
                channels: {} as never,
            }),
        ).toThrow(/channels 必须是数组/u);
        expect(() =>
            normalizeIrcv3Config({
                account_id: "malformed",
                nickname: "bot",
                receive_mode: "manual",
                tls: "false" as never,
            }),
        ).toThrow(/tls 必须是布尔值/u);
    });

    it("narrows negotiated event, segment and history capabilities at runtime", () => {
        const client = new Ircv3Client({
            account_id: "manual",
            nickname: "bot",
            receive_mode: "manual",
            event_commands: ["PRIVMSG", "TAGMSG"],
        });
        const capabilities = describeIrcv3Capabilities(client.config, client);
        expect(capabilities.actions.get_message_history?.support).toBe("unsupported");
        expect(capabilities.events.typing_started?.support).toBe("unsupported");
        expect(capabilities.segments.reply?.support).toBe("unsupported");
    });

    it("implements every advertised canonical and platform action", async () => {
        const databasePath = `/tmp/onebots-ircv3-${process.pid}`;
        const database = new SqliteDB(databasePath);
        const adapter = new Ircv3Adapter({
            db: database,
            config: { general: {} },
            router: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
            getLogger: () => ({
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                fatal: vi.fn(),
                mark: vi.fn(),
            }),
        } as unknown as BaseApp);
        try {
            await expect(assertAdapterCapabilityContract(adapter)).resolves.toBeUndefined();
        } finally {
            database.close();
            await rm(`${databasePath}.db`, { force: true });
        }
    });
});
