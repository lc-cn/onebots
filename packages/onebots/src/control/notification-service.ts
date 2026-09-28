import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseNotificationConfig, publicNotificationConfig } from "./notification-config.js";
import {
    BarkPartialDeliveryError,
    deliverBark,
    deliverEmail,
    deliverWebhook,
} from "./notification-delivery.js";
import type {
    NotificationChannel,
    NotificationEvent,
    NotificationEventType,
} from "./notification-types.js";
import { notificationTypeForOperation } from "./notification-types.js";
import type { ControlVerificationChallenge } from "@onebots/core/control";
import type { PersistedOperationProjection } from "../persisted-operation-observer.js";
import { initialNotificationState, type NotificationState } from "./notification-state.js";

const BATCH_MS = 30_000;
const MAX_DELIVERIES = 10_000;
const MAX_RETRY_AGE_MS = 72 * 60 * 60 * 1000;
/** 管理工作区锁保护单写者；配置和投递队列同一次原子替换，重启后继续重试。 */
export class ControlNotificationService {
    private readonly file: string;
    private state: NotificationState;
    private readonly timer: NodeJS.Timeout;
    private closed = false;
    private pumping = false;
    private activePump?: Promise<void>;
    private resolveChallenge?: (id: string) => Promise<ControlVerificationChallenge | undefined>;
    constructor(
        directory: string,
        private readonly now: () => number = Date.now,
    ) {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const stat = fs.lstatSync(directory);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (process.getuid && stat.uid !== process.getuid()) ||
            (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700)
        )
            throw new Error("通知存储目录无效");
        this.file = path.join(directory, "state.json");
        if (fs.existsSync(this.file)) {
            const fileStat = fs.lstatSync(this.file);
            if (
                !fileStat.isFile() ||
                fileStat.isSymbolicLink() ||
                fileStat.nlink !== 1 ||
                (process.getuid && fileStat.uid !== process.getuid()) ||
                (process.platform !== "win32" && (fileStat.mode & 0o777) !== 0o600)
            )
                throw new Error("通知存储文件无效");
            const value: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
            if (!value || typeof value !== "object" || Array.isArray(value))
                throw new Error("通知存储损坏");
            const stored = value as NotificationState;
            this.state = {
                ...stored,
                config: parseNotificationConfig(stored.config),
                droppedDeliveries: Number.isSafeInteger(stored.droppedDeliveries)
                    ? stored.droppedDeliveries
                    : 0,
            };
            if (
                stored.schemaVersion !== 1 ||
                !Array.isArray(stored.deliveries) ||
                !stored.accounts ||
                !Array.isArray(stored.seenChallenges) ||
                !Array.isArray(stored.seenOperations)
            )
                throw new Error("通知存储版本无效");
        } else this.state = initialNotificationState();
        this.timer = setInterval(() => this.runPump(), 1_000);
        this.timer.unref();
    }

    snapshot() {
        return {
            config: publicNotificationConfig(this.state.config),
            deliveries: this.state.deliveries
                .slice(-200)
                .reverse()
                .map(item => ({ ...item })),
            droppedDeliveries: this.state.droppedDeliveries,
        };
    }

    setChallengeResolver(
        resolve: (id: string) => Promise<ControlVerificationChallenge | undefined>,
    ): void {
        this.resolveChallenge = resolve;
    }

    configure(input: unknown) {
        if (this.closed) throw new Error("通知服务已关闭");
        const config = parseNotificationConfig(input, this.state.config);
        const previous = this.state.config;
        this.state.config = config;
        try {
            this.save();
        } catch (error) {
            this.state.config = previous;
            throw error;
        }
        return publicNotificationConfig(config);
    }

    async test(channelId: string): Promise<void> {
        const channel = this.state.config.channels.find(item => item.id === channelId);
        if (!channel) throw new Error("通知渠道不存在");
        await this.deliver(channel, [
            {
                id: randomUUID(),
                type: "gateway.failed",
                occurredAt: new Date(this.now()).toISOString(),
                title: "通知测试",
                summary: "OneBots 通知渠道测试成功。",
            },
        ]);
    }

    retry(id: string): void {
        const item = this.state.deliveries.find(delivery => delivery.id === id);
        if (!item) throw new Error("投递记录不存在");
        if (item.status === "delivered") throw new Error("已投递通知不能再次发送");
        if (
            item.events[0]?.type === "login.interaction" &&
            this.now() - Date.parse(item.createdAt) > 30 * 60 * 1000
        )
            throw new Error("登录挑战已过期，不能重新发送");
        item.status = "pending";
        item.nextAttemptAt = new Date(this.now()).toISOString();
        item.lastError = undefined;
        this.save();
        this.runPump();
    }

    observeOperation(operation: PersistedOperationProjection): void {
        if (operation.status !== "failed" && operation.status !== "unknown") return;
        if (this.state.seenOperations.includes(operation.id)) return;
        this.state.seenOperations.push(operation.id);
        this.state.seenOperations = this.state.seenOperations.slice(-1000);
        const type = notificationTypeForOperation(operation.action);
        if (type)
            this.record(
                type,
                "服务操作失败",
                `${operation.action} 操作未完成，请到管理台查看诊断。`,
            );
        else this.save();
    }

    gatewayExited(): void {
        this.record("gateway.failed", "网关异常退出", "网关进程异常退出，请到管理台查看诊断。");
    }

    observeAccounts(
        items: Array<{
            platform: string;
            accountId: string;
            status: "pending" | "online" | "offline";
        }>,
    ): void {
        let changed = false;
        const incoming = new Set(
            items.map(item => JSON.stringify([item.platform, item.accountId])),
        );
        for (const item of items) {
            const key = JSON.stringify([item.platform, item.accountId]);
            const previous = this.state.accounts[key];
            if (
                previous?.status === item.status &&
                !(item.status === "online" && previous.disconnected)
            )
                continue;
            changed = true;
            const account = { platform: item.platform, accountId: item.accountId };
            if (item.status === "online") {
                const duration =
                    previous?.offlineAt === undefined ? undefined : this.now() - previous.offlineAt;
                const coalesced =
                    previous?.offlineAt === undefined
                        ? new Set<string>()
                        : this.coalesceRecovery(account, previous.offlineAt);
                if (coalesced.size || (duration !== undefined && duration <= BATCH_MS)) {
                    this.record(
                        "account.brief-outage",
                        "账号短暂离线并恢复",
                        `${item.platform}/${item.accountId} 短暂离线 ${Math.ceil((duration ?? 0) / 1000)} 秒后恢复。`,
                        account,
                        undefined,
                        coalesced,
                    );
                } else
                    this.record(
                        previous?.everOnline ? "account.recovered" : "account.online",
                        previous?.everOnline ? "账号恢复在线" : "账号首次上线",
                        `${item.platform}/${item.accountId} 已在线。`,
                        account,
                    );
            } else if (item.status === "offline" && previous?.status === "online") {
                this.record(
                    "account.offline",
                    "账号离线",
                    `${item.platform}/${item.accountId} 已离线。`,
                    account,
                );
            }
            this.state.accounts[key] = {
                status: item.status,
                everOnline: previous?.everOnline || item.status === "online",
                offlineAt:
                    item.status === "offline"
                        ? previous?.status === "online"
                            ? this.now()
                            : previous?.offlineAt
                        : undefined,
                disconnected: item.status === "online" ? false : previous?.disconnected,
            };
        }
        for (const [key, account] of Object.entries(this.state.accounts)) {
            if (incoming.has(key) || account.status !== "online") continue;
            changed = true;
            const [platform, accountId] = JSON.parse(key) as [string, string];
            this.record("account.offline", "账号离线", `${platform}/${accountId} 已离线。`, {
                platform,
                accountId,
            });
            account.status = "offline";
            account.offlineAt = this.now();
        }
        if (changed) this.save();
    }

    observeChallenges(challenges: ControlVerificationChallenge[]): void {
        for (const challenge of challenges) {
            if (
                this.state.seenChallenges.includes(challenge.id) ||
                challenge.expiresAt <= this.now()
            )
                continue;
            this.state.seenChallenges.push(challenge.id);
            this.state.seenChallenges = this.state.seenChallenges.slice(-1000);
            this.record(
                "login.interaction",
                "账号等待登录交互",
                `${challenge.request.platform}/${challenge.request.account_id} 需要登录验证，请打开受保护的管理台处理。`,
                { platform: challenge.request.platform, accountId: challenge.request.account_id },
                challenge.id,
            );
        }
    }

    /** 只有显式 transport 断开帧可调用；普通 pending/offline 不推断为网络中断。 */
    observeDisconnect(account: { platform: string; accountId: string }): void {
        const key = JSON.stringify([account.platform, account.accountId]);
        const previous = this.state.accounts[key];
        if (previous?.disconnected) return;
        this.state.accounts[key] = {
            status: previous?.status ?? "pending",
            everOnline: previous?.everOnline ?? false,
            ...(previous?.offlineAt !== undefined ? { offlineAt: previous.offlineAt } : {}),
            disconnected: true,
        };
        this.record(
            "account.disconnected",
            "账号连接中断",
            `${account.platform}/${account.accountId} 与平台连接中断。`,
            account,
        );
    }

    private coalesceRecovery(
        account: { platform: string; accountId: string },
        offlineAt: number,
    ): Set<string> {
        const changed = new Set<string>();
        if (this.now() - offlineAt > BATCH_MS) return changed;
        for (const delivery of this.state.deliveries) {
            if (delivery.status !== "pending" || delivery.attempts !== 0) continue;
            for (const event of delivery.events) {
                if (
                    event.type !== "account.offline" ||
                    event.account?.platform !== account.platform ||
                    event.account?.accountId !== account.accountId
                )
                    continue;
                event.type = "account.brief-outage";
                event.title = "账号短暂离线并恢复";
                event.durationMs = this.now() - offlineAt;
                event.summary = `${account.platform}/${account.accountId} 短暂离线 ${Math.ceil(event.durationMs / 1000)} 秒后恢复。`;
                changed.add(delivery.channelId);
            }
        }
        return changed;
    }

    private record(
        type: NotificationEventType,
        title: string,
        summary: string,
        account?: { platform: string; accountId: string },
        challengeId?: string,
        excludeChannels = new Set<string>(),
    ): void {
        const event: NotificationEvent = {
            id: randomUUID(),
            type,
            title,
            summary,
            occurredAt: new Date(this.now()).toISOString(),
            ...(account ? { account } : {}),
            ...(challengeId ? { challengeId } : {}),
        };
        const channels = new Set<string>();
        const accountKey = account && `${account.platform}/${account.accountId}`;
        for (const rule of this.state.config.rules) {
            if (
                !rule.enabled ||
                !(
                    rule.events.includes(type) ||
                    (type === "account.brief-outage" && rule.events.includes("account.recovered"))
                ) ||
                (rule.accounts !== "all" && (!accountKey || !rule.accounts.includes(accountKey)))
            )
                continue;
            for (const id of rule.channelIds) channels.add(id);
        }
        this.prune();
        for (const channelId of channels) {
            if (excludeChannels.has(channelId)) continue;
            const channel = this.state.config.channels.find(item => item.id === channelId);
            if (!channel?.enabled) continue;
            if (this.state.deliveries.length >= MAX_DELIVERIES) {
                this.state.droppedDeliveries++;
                process.stderr.write("[onebots] 通知投递队列已满，请在管理台清理故障\n");
                break;
            }
            const batchable = type.startsWith("account.");
            const pending =
                batchable &&
                this.state.deliveries.find(
                    item =>
                        item.channelId === channelId &&
                        item.status === "pending" &&
                        item.attempts === 0 &&
                        item.events[0]?.type === type &&
                        this.now() - Date.parse(item.createdAt) < BATCH_MS,
                );
            if (pending) pending.events.push(event);
            else
                this.state.deliveries.push({
                    id: randomUUID(),
                    channelId,
                    events: [event],
                    status: "pending",
                    attempts: 0,
                    createdAt: new Date(this.now()).toISOString(),
                    nextAttemptAt: new Date(this.now() + (batchable ? BATCH_MS : 0)).toISOString(),
                });
        }
        this.save();
    }

    private async deliver(
        channel: NotificationChannel,
        events: NotificationEvent[],
        challenge?: ControlVerificationChallenge,
    ): Promise<void> {
        if (channel.type === "webhook")
            await deliverWebhook(channel, this.state.config, events, challenge);
        else if (channel.type === "bark") await deliverBark(channel, this.state.config, events);
        else await deliverEmail(channel, this.state.config, events, challenge);
    }

    private runPump(): void {
        if (this.activePump || this.closed) return;
        this.activePump = this.pump()
            .catch(() => {
                process.stderr.write("[onebots] 通知投递状态无法持久化\n");
            })
            .finally(() => {
                this.activePump = undefined;
            });
    }

    private async pump(): Promise<void> {
        if (this.pumping || this.closed) return;
        this.pumping = true;
        try {
            // 有界并发避免某个超时渠道阻塞其他渠道；登录挑战优先于积压状态摘要。
            const due = this.state.deliveries
                .filter(
                    item =>
                        item.status === "pending" && Date.parse(item.nextAttemptAt) <= this.now(),
                )
                .sort(
                    (left, right) =>
                        Number(right.events[0]?.type === "login.interaction") -
                        Number(left.events[0]?.type === "login.interaction"),
                )
                .slice(0, 16);
            const results = await Promise.allSettled(
                due.map(async item => {
                    const channel = this.state.config.channels.find(
                        value => value.id === item.channelId,
                    );
                    if (!channel) {
                        item.status = "failed";
                        item.lastError = "渠道已删除";
                        this.save();
                        return;
                    }
                    if (!channel.enabled) return;
                    if (
                        item.events[0]?.type === "login.interaction" &&
                        this.now() - Date.parse(item.createdAt) > 30 * 60 * 1000
                    ) {
                        item.status = "failed";
                        item.lastError = "登录挑战已过期";
                        this.save();
                        return;
                    }
                    try {
                        const challengeId = item.events[0]?.challengeId;
                        const challenge =
                            challengeId && channel.includeChallengeLink
                                ? await this.resolveChallenge?.(challengeId)
                                : undefined;
                        if (
                            challengeId &&
                            channel.includeChallengeLink &&
                            (!challenge || challenge.expiresAt <= this.now())
                        ) {
                            item.status = "failed";
                            item.lastError = "登录挑战已失效";
                            this.save();
                            return;
                        }
                        await this.deliver(channel, item.events, challenge);
                        item.status = "delivered";
                        item.deliveredAt = new Date(this.now()).toISOString();
                        item.lastError = undefined;
                    } catch (error) {
                        item.attempts++;
                        item.lastError =
                            error instanceof BarkPartialDeliveryError
                                ? "Bark 部分设备失败，已停止自动重试；手动重试可能重复通知已成功设备"
                                : "投递失败，请检查目标地址、认证和网络";
                        if (
                            error instanceof BarkPartialDeliveryError ||
                            this.now() - Date.parse(item.createdAt) > MAX_RETRY_AGE_MS
                        )
                            item.status = "failed";
                        else
                            item.nextAttemptAt = new Date(
                                this.now() +
                                    Math.min(3_600_000, 5_000 * 2 ** Math.min(item.attempts, 10)),
                            ).toISOString();
                    }
                    this.save();
                }),
            );
            if (results.some(result => result.status === "rejected"))
                throw new Error("通知状态持久化失败");
        } finally {
            this.pumping = false;
        }
    }

    private save(): void {
        const file = `${this.file}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(file, JSON.stringify(this.state), { mode: 0o600, flag: "wx" });
            fs.renameSync(file, this.file);
        } finally {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
    }

    private prune(): void {
        const completed = this.state.deliveries.filter(item => item.status !== "pending");
        if (completed.length <= 2_000) return;
        const keep = new Set(completed.slice(-2_000).map(item => item.id));
        this.state.deliveries = this.state.deliveries.filter(
            item => item.status === "pending" || keep.has(item.id),
        );
    }

    async close(): Promise<void> {
        this.closed = true;
        clearInterval(this.timer);
        await this.activePump;
    }
}
