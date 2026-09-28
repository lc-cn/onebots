import { describe, expect, it } from "vitest";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import type { NotificationSnapshot } from "./notification-model.js";
import {
    controlAttention,
    controlMutationBlock,
    setupJourney,
    workspaceReadiness,
} from "./control-product-state.js";

const selection = { adapters: [], protocols: [], applications: [] };
const catalog = (
    override: Partial<ControlInstallationCatalog> = {},
): ControlInstallationCatalog => ({
    activeGenerationId: null,
    selection,
    adapters: [],
    protocols: [],
    applications: [],
    ...override,
});
const configuration = (
    override: Partial<ControlConfigurationSnapshot> = {},
): ControlConfigurationSnapshot => ({
    base: { generationId: null, configRevision: "a".repeat(64) },
    document: { log_level: "info" },
    schemas: {},
    secretStates: [],
    unknownPaths: [],
    ...override,
});
const status = (override: Partial<ControlStatus> = {}): ControlStatus => ({
    schemaVersion: 1,
    manager: { id: "manager", version: "1.0.0" },
    gateway: {
        desired: "stopped",
        actual: "stopped",
        recoveryRequired: false,
        operations: [],
    },
    ...override,
});

const notifications = (override: Partial<NotificationSnapshot> = {}): NotificationSnapshot => ({
    config: {
        schemaVersion: 1,
        externalUrl: "",
        smtpProfiles: [],
        recipientGroups: [],
        channels: [],
        rules: [],
    },
    deliveries: [],
    droppedDeliveries: 0,
    ...override,
});

describe("controlAttention", () => {
    it("仅在有确定事实时引导首次配置，不将未知通知状态视为缺失", () => {
        const journey = setupJourney(catalog(), configuration(), status());
        expect(
            controlAttention(undefined, journey, undefined, undefined).map(item => item.action),
        ).toEqual(["extensions"]);
        expect(
            controlAttention(status(), setupJourney(undefined, undefined, status()), undefined, 0),
        ).toEqual([]);
    });

    it("网关启动失败与通知队列溢出可直达诊断和投递记录", () => {
        const failed = status({
            gateway: {
                desired: "running",
                actual: "failed",
                recoveryRequired: false,
                operations: [],
            },
        });
        const journey = setupJourney(catalog(), configuration(), failed);
        expect(
            controlAttention(failed, journey, notifications({ droppedDeliveries: 3 }), 0).map(
                item => item.action,
            ),
        ).toEqual(["diagnostics", "notification-history", "extensions"]);
    });

    it("关联验证、投递失败、账号和协议故障，并为已运行但未配置通知的用户给出入口", () => {
        const running = status({
            gateway: {
                desired: "running",
                actual: "running",
                recoveryRequired: false,
                operations: [],
            },
            accounts: {
                available: true,
                items: [
                    {
                        platform: "mock",
                        accountId: "10000",
                        status: "offline",
                        protocols: [{ name: "onebot", version: "v11", status: "failed" }],
                    },
                ],
            },
        });
        const journey = setupJourney(
            catalog({
                selection: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
            }),
            configuration({
                document: { "mock.10000": { "onebot.v11": {} } },
                schemas: { protocols: { "onebot.v11": {} } },
            }),
            running,
        );
        const snapshot = notifications({
            deliveries: [
                {
                    id: "delivery",
                    channelId: "channel",
                    status: "failed",
                    attempts: 1,
                    createdAt: "2026-09-26T00:00:00Z",
                    events: [],
                },
            ],
        });
        expect(controlAttention(running, journey, snapshot, 2).map(item => item.action)).toEqual([
            "verification",
            "notification-history",
            "accounts",
            "protocol-configuration",
            "notification-setup",
        ]);
        snapshot.config.channels.push({
            id: "channel",
            name: "暂停的渠道",
            type: "webhook",
            enabled: false,
            includeChallengeLink: false,
            url: "https://example.com/events",
            allowPrivateNetwork: false,
            auth: { type: "none" },
        });
        snapshot.config.rules.push({
            id: "rule",
            name: "暂停的规则",
            enabled: false,
            events: ["gateway.failed"],
            accounts: "all",
            channelIds: ["channel"],
        });
        expect(
            controlAttention(running, journey, snapshot, 2).map(item => item.action),
        ).not.toContain("notification-setup");
    });
});

describe("workspaceReadiness", () => {
    it("only declares a workspace empty from both authoritative snapshots", () => {
        expect(workspaceReadiness(undefined, configuration())).toBe("loading");
        expect(workspaceReadiness(catalog(), undefined)).toBe("loading");
        expect(workspaceReadiness(catalog(), configuration())).toBe("empty");
    });

    it("does not hide configured or unprojected state behind onboarding", () => {
        expect(
            workspaceReadiness(
                catalog({ selection: { ...selection, adapters: ["mock"] } }),
                configuration(),
            ),
        ).toBe("configured");
        expect(
            workspaceReadiness(catalog(), configuration({ unknownPaths: [["legacy.account"]] })),
        ).toBe("configured");
        expect(workspaceReadiness(catalog(), configuration(), true)).toBe("unavailable");
    });
});

describe("setupJourney", () => {
    it("guides an empty workspace through extensions, configuration and start", () => {
        expect(setupJourney(catalog(), configuration(), status()).state).toBe("needs-extensions");

        const installed = catalog({
            activeGenerationId: "generation",
            selection: { adapters: ["mock"], protocols: ["onebot-v11"], applications: ["zhin"] },
        });
        const needsAccount = setupJourney(installed, configuration(), status());
        expect(needsAccount.state).toBe("needs-configuration");
        expect(needsAccount.nextWorkspace).toBe("accounts");
        expect(needsAccount.counts).toEqual({
            adapters: 1,
            protocols: 1,
            applications: 1,
            accounts: 0,
        });

        const accountOnly = configuration({
            document: { "mock.10000": { token: "redacted" } },
            schemas: { protocols: { "onebot.v11": {} } },
        });
        const needsProtocol = setupJourney(installed, accountOnly, status());
        expect(needsProtocol.state).toBe("needs-configuration");
        expect(needsProtocol.nextWorkspace).toBe("protocols");
        expect(needsProtocol.nextLabel).toBe("为账号配置协议出口");
        expect(controlAttention(status(), needsProtocol, undefined, 0)[0]?.action).toBe(
            "protocol-configuration",
        );
        expect(needsProtocol.steps[1].status).toBe("current");

        const globalOnly = configuration({
            document: {
                general: { "onebot.v11": { use_http: true } },
                "mock.10000": { token: "redacted" },
            },
            schemas: { protocols: { "onebot.v11": {} } },
        });
        expect(setupJourney(installed, globalOnly, status()).state).toBe("needs-configuration");

        const configured = configuration({
            document: { "mock.10000": { token: "redacted", "onebot.v11": {} } },
            schemas: { protocols: { "onebot.v11": {} } },
        });
        expect(setupJourney(installed, configured, status()).state).toBe("ready-to-start");
        expect(
            setupJourney(
                installed,
                configured,
                status({
                    gateway: {
                        desired: "running",
                        actual: "running",
                        recoveryRequired: false,
                        operations: [],
                    },
                }),
            ).state,
        ).toBe("running");
    });

    it("does not invent progress while authoritative facts are unavailable", () => {
        expect(setupJourney(undefined, configuration(), status()).state).toBe("loading");
        expect(setupJourney(catalog(), configuration(), status(), true).state).toBe("unavailable");
    });

    it("routes a gateway recovery state to diagnostics instead of start", () => {
        const installed = catalog({
            selection: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
        });
        const configured = configuration({ document: { "mock.10000": {} } });
        const journey = setupJourney(
            installed,
            configured,
            status({
                gateway: {
                    desired: "running",
                    actual: "failed",
                    recoveryRequired: true,
                    operations: [],
                },
            }),
        );
        expect(journey.state).toBe("recovery");
        expect(journey.nextWorkspace).toBe("activity");
        expect(journey.nextLabel).toBe("打开恢复诊断");
    });
});

describe("controlMutationBlock", () => {
    it("prioritizes recovery, then migration, then explicit ownership failure", () => {
        expect(
            controlMutationBlock(
                status({
                    serviceMigration: { pending: true, recoveryRequired: true },
                    processOwnership: { available: false },
                }),
            )?.kind,
        ).toBe("service-recovery");
        expect(
            controlMutationBlock(
                status({ serviceMigration: { pending: true, recoveryRequired: false } }),
            )?.kind,
        ).toBe("service-migration");
        expect(controlMutationBlock(status({ processOwnership: { available: false } }))?.kind).toBe(
            "process-ownership",
        );
    });

    it("does not invent a blocker when optional evidence is absent or healthy", () => {
        expect(controlMutationBlock(status())).toBeUndefined();
        expect(
            controlMutationBlock(
                status({
                    serviceMigration: { pending: false, recoveryRequired: false },
                    processOwnership: { available: true },
                }),
            ),
        ).toBeUndefined();
    });
});
