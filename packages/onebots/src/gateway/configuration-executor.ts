import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { RuntimeConfigurationRejectedError, type BaseApp } from "@onebots/core";
import { parseRuntimeConfig, validateRuntimeConfig } from "../runtime-config-validator.js";
import { mergeRuntimeConfigDefaults } from "../runtime-defaults.js";
import type { GatewayStartMessage } from "./contracts.js";
import {
    isGatewayConfigurationRequest,
    type GatewayConfigurationReply,
    type GatewayConfigurationRequest,
    type GatewayConfigurationResult,
} from "./configuration-contracts.js";

interface Receipt {
    digest: string;
    expectedConfigVersion: string;
    result?: GatewayConfigurationResult;
    pending: Promise<GatewayConfigurationReply["outcome"]>;
}

/** 子进程只消费受管快照；所有热应用串行、按操作去重，不读取可变工作区配置。 */
export class GatewayConfigurationExecutor {
    private readonly receipts = new Map<string, Receipt>();
    private queue: Promise<unknown> = Promise.resolve();
    private closed = false;
    constructor(
        private readonly app: Pick<BaseApp, "applyRuntimeConfiguration">,
        private readonly identity: GatewayStartMessage,
        private readonly onApplied: (configVersion: string) => void,
    ) {}

    close(): void {
        this.closed = true;
    }

    handle(value: unknown, send: (reply: GatewayConfigurationReply) => void): boolean {
        if (
            !value ||
            typeof value !== "object" ||
            types.isProxy(value) ||
            Object.getOwnPropertyDescriptor(value, "type")?.value !== "gateway.configuration"
        )
            return false;
        if (
            !isGatewayConfigurationRequest(value) ||
            value.controlInstanceId !== this.identity.controlInstanceId ||
            value.gatewayInstanceId !== this.identity.gatewayInstanceId
        )
            return true;
        const base = {
            type: "gateway.configuration.result" as const,
            protocolVersion: 1 as const,
            controlInstanceId: this.identity.controlInstanceId,
            gatewayInstanceId: this.identity.gatewayInstanceId,
            requestId: value.requestId,
            operationId: value.operationId,
        };
        const deliver = (
            outcome: GatewayConfigurationReply["outcome"],
            result?: GatewayConfigurationResult,
        ) => {
            try {
                send({
                    ...base,
                    outcome,
                    ...(outcome === "succeeded" && result ? { result } : {}),
                });
            } catch {
                /* IPC 断连后只能由管理端对账，不重发、不重新执行。 */
            }
        };
        const previous = this.receipts.get(value.operationId);
        if (value.action === "query") {
            if (previous && previous.expectedConfigVersion !== value.expectedConfigVersion)
                deliver("rejected");
            else if (previous?.result) deliver("succeeded", previous.result);
            else deliver("unknown");
            return true;
        }
        const digest = createHash("sha256")
            .update(
                JSON.stringify({
                    expected: value.expectedConfigVersion,
                    next: value.nextConfigVersion,
                    path: value.configPath,
                }),
            )
            .digest("hex");
        if (previous) {
            if (previous.digest !== digest) deliver("rejected");
            else
                void previous.pending.then(outcome =>
                    deliver(previous.result ? "succeeded" : outcome, previous.result),
                );
            return true;
        }
        if (this.closed || this.receipts.size >= 4096) {
            deliver("rejected");
            return true;
        }
        const receipt: Receipt = {
            digest,
            expectedConfigVersion: value.expectedConfigVersion,
            pending: Promise.resolve("unknown"),
        };
        this.receipts.set(value.operationId, receipt);
        // 回执先注册再排队；相同编号无法抢先产生第二次外部效果。
        receipt.pending = this.queue.then(async () => {
            const outcome = await this.apply(value, receipt);
            if (outcome === "rejected")
                receipt.result = { status: "rejected", configVersion: this.identity.configVersion };
            return outcome;
        });
        this.queue = receipt.pending.catch(() => undefined);
        void receipt.pending.then(
            outcome => deliver(receipt.result ? "succeeded" : outcome, receipt.result),
            () => deliver("unknown"),
        );
        return true;
    }

    private async apply(
        request: GatewayConfigurationRequest,
        receipt: Receipt,
    ): Promise<GatewayConfigurationReply["outcome"]> {
        if (this.closed || request.expectedConfigVersion !== this.identity.configVersion)
            return "rejected";
        let config;
        try {
            const directory = path.join(
                fs.realpathSync(this.identity.workspacePath),
                ".control",
                "configurations",
            );
            const file = path.join(directory, `${request.nextConfigVersion}.yaml`);
            if (request.configPath !== file || fs.realpathSync(directory) !== directory)
                return "rejected";
            const stat = fs.lstatSync(file);
            if (
                !stat.isFile() ||
                stat.isSymbolicLink() ||
                stat.nlink !== 1 ||
                stat.size > 8 * 1024 * 1024 ||
                (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
            )
                return "rejected";
            const bytes = fs.readFileSync(file);
            if (createHash("sha256").update(bytes).digest("hex") !== request.nextConfigVersion)
                return "rejected";
            config = parseRuntimeConfig(bytes.toString("utf8"));
            if (["username", "password", "access_token"].some(key => Object.hasOwn(config, key)))
                return "rejected";
            validateRuntimeConfig(config);
        } catch {
            return "rejected";
        }
        try {
            const result = await this.app.applyRuntimeConfiguration(
                mergeRuntimeConfigDefaults(config),
            );
            if (result.status === "applied") {
                this.identity.configVersion = request.nextConfigVersion!;
                this.onApplied(this.identity.configVersion);
            }
            receipt.result = { status: result.status, configVersion: this.identity.configVersion };
            return "succeeded";
        } catch (error) {
            if (error instanceof RuntimeConfigurationRejectedError) return "rejected";
            // 运行态协调器抛出后无法推断是否已回滚，固定标记未知，禁止重新派发。
            process.stderr.write("[onebots] 热配置应用未确认，请通过管理服务查询原操作\n");
            return "unknown";
        }
    }
}
