import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { Adapter } from "@onebots/core";
import {
    verificationJson,
    verificationRequest,
    type ControlVerificationChallenge,
} from "@onebots/core/control";

const MAX_CHALLENGES = 20;
const MAX_REQUEST_BYTES = 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;

export type GatewayVerificationChallenge = ControlVerificationChallenge;

/** IPC 收据复用挑战存储的字段规则，不执行来自 SDK 的访问器。 */
export function isGatewayVerificationChallenge(
    value: unknown,
): value is GatewayVerificationChallenge {
    try {
        if (!value || typeof value !== "object" || types.isProxy(value)) return false;
        if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
        const fields = ["id", "createdAt", "expiresAt", "request"];
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (
            Reflect.ownKeys(descriptors).length !== fields.length ||
            fields.some(key => !descriptors[key]?.enumerable || !("value" in descriptors[key]))
        )
            return false;
        const id: unknown = descriptors.id.value;
        const created: unknown = descriptors.createdAt.value;
        const expires: unknown = descriptors.expiresAt.value;
        return (
            typeof id === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) &&
            typeof created === "number" &&
            Number.isSafeInteger(created) &&
            created >= 0 &&
            typeof expires === "number" &&
            Number.isSafeInteger(expires) &&
            expires > created &&
            expires - created <= TTL_MS &&
            request(snapshot(descriptors.request.value))
        );
    } catch {
        // 不可信帧只拒绝，不读取或输出其异常对象。
        return false;
    }
}

/** Node 边界额外拒绝 Proxy，字段及字节限制与控制客户端共用。 */
const snapshot = (input: unknown) => verificationJson(input, MAX_REQUEST_BYTES, types.isProxy);
const request = verificationRequest;

export class GatewayVerificationStore {
    private readonly challenges = new Map<string, GatewayVerificationChallenge>();
    private closed = false;

    constructor(private readonly now: () => number = Date.now) {}

    record(input: Adapter.VerificationRequest): void {
        if (this.closed) return;
        try {
            const data = snapshot(input);
            if (!request(data)) return;
            // 经无副作用复制及字段校验后，JSON 往返生成独立的普通对象。
            const cloned = JSON.parse(JSON.stringify(data)) as Adapter.VerificationRequest;
            const createdAt = this.now();
            const challenge = {
                id: randomUUID(),
                createdAt,
                expiresAt: createdAt + TTL_MS,
                request: cloned,
            };
            const key = JSON.stringify([cloned.platform, cloned.account_id, cloned.type]);
            this.expire();
            this.challenges.delete(key);
            this.challenges.set(key, challenge);
            if (this.challenges.size > MAX_CHALLENGES) {
                const oldest = this.challenges.keys().next();
                if (!oldest.done) this.challenges.delete(oldest.value);
            }
        } catch {
            // 验证旁路忽略坏 SDK 数据；不能中断账号事件分发，也不读取异常对象。
        }
    }

    clear(input: Adapter.VerificationClear): void {
        try {
            const value = snapshot(input);
            if (
                !value ||
                typeof value !== "object" ||
                Array.isArray(value) ||
                !Object.keys(value).every(key =>
                    ["platform", "account_id", "type"].includes(key),
                ) ||
                typeof value.platform !== "string" ||
                !value.platform.trim() ||
                typeof value.account_id !== "string" ||
                !value.account_id.trim() ||
                (Object.hasOwn(value, "type") &&
                    (typeof value.type !== "string" || !value.type.trim()))
            )
                return;
            for (const [key, challenge] of this.challenges) {
                if (
                    challenge.request.platform === value.platform &&
                    challenge.request.account_id === value.account_id &&
                    (!Object.hasOwn(value, "type") || challenge.request.type === value.type)
                )
                    this.challenges.delete(key);
            }
        } catch {
            // 与 record 相同：无效清理事件不得删除有效挑战或打断账号事件。
        }
    }

    list(): GatewayVerificationChallenge[] {
        this.expire();
        return structuredClone([...this.challenges.values()]);
    }

    get(id: string): GatewayVerificationChallenge | undefined {
        this.expire();
        const challenge = [...this.challenges.values()].find(item => item.id === id);
        return challenge && structuredClone(challenge);
    }

    complete(id: string): boolean {
        this.expire();
        for (const [key, challenge] of this.challenges) {
            if (challenge.id !== id) continue;
            this.challenges.delete(key);
            return true;
        }
        return false;
    }

    close(): void {
        this.closed = true;
        this.challenges.clear();
    }

    private expire(): void {
        const now = this.now();
        for (const [key, challenge] of this.challenges) {
            if (challenge.expiresAt <= now) this.challenges.delete(key);
        }
    }
}
