import { ref, onMounted, onUnmounted } from "vue";
import type { VerificationRequest, VerificationClearEvent } from "../types";
import { buildApiUrl } from "../config";
import { authFetch } from "./useAuth";
import {
    openAuthenticatedEventStream,
    type AuthenticatedEventStream,
} from "../authenticated-event-stream.js";
import { reportClientError } from "../client-diagnostics";
import {
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "../management-evidence-identity.js";
import {
    isVerificationRequest,
    parseVerificationStreamIdentity,
    readVerificationMutationResult,
    readVerificationSnapshot,
    verificationMutationHeaders,
} from "../verification-management.js";

/** 合并单条验证到列表（同 platform+account_id+type 只保留最新） */
function mergePending(
    list: VerificationRequest[],
    item: VerificationRequest,
): VerificationRequest[] {
    return [
        ...list.filter(
            r =>
                !(
                    r.platform === item.platform &&
                    r.account_id === item.account_id &&
                    r.type === item.type
                ),
        ),
        item,
    ];
}

function isClearEvent(payload: unknown): payload is VerificationClearEvent {
    return (
        !!payload &&
        typeof payload === "object" &&
        (payload as VerificationClearEvent).event === "clear" &&
        typeof (payload as VerificationClearEvent).platform === "string" &&
        typeof (payload as VerificationClearEvent).account_id === "string"
    );
}

export function useVerification() {
    const pending = ref<VerificationRequest[]>([]);
    /** 仅在有新验证通过 SSE 到达时置为 true，用于自动打开抽屉；首屏拉取的待处理列表不自动弹窗 */
    const shouldOpenDrawer = ref(false);
    let verificationEventSource: AuthenticatedEventStream | null = null;
    let verificationIdentity: ManagementEvidenceIdentity | null = null;
    let pendingRequestGeneration = 0;
    let streamIdentityEstablished = false;

    /** 从服务端拉取待处理验证（Web 未在线时产生的验证，打开页面后可补拉） */
    const fetchPending = async () => {
        const generation = ++pendingRequestGeneration;
        try {
            const response = await authFetch(buildApiUrl("/api/verification/pending"));
            const snapshot = await readVerificationSnapshot(response);
            if (generation !== pendingRequestGeneration) return;
            verificationIdentity = snapshot.identity;
            const next: VerificationRequest[] = [];
            for (const item of snapshot.items) {
                if (item.platform && item.account_id && item.type) {
                    next.push(item);
                }
            }
            pending.value = next;
        } catch (error) {
            reportClientError("拉取待处理验证失败", error);
        }
    };

    const applyClear = (payload: VerificationClearEvent) => {
        pending.value = pending.value.filter(r => {
            if (r.platform !== payload.platform || r.account_id !== payload.account_id) return true;
            if (!payload.type) return false;
            return r.type !== payload.type;
        });
    };

    const connect = () => {
        verificationEventSource?.close();
        verificationEventSource = openAuthenticatedEventStream(
            buildApiUrl("/api/verification/stream"),
            {
                onOpen() {
                    streamIdentityEstablished = false;
                },
                onMessage(data) {
                    try {
                        const payload: unknown = JSON.parse(data);
                        const streamIdentity = parseVerificationStreamIdentity(payload);
                        if (streamIdentity) {
                            streamIdentityEstablished = true;
                            const changed =
                                verificationIdentity !== null &&
                                !sameManagementEvidenceIdentity(
                                    verificationIdentity,
                                    streamIdentity,
                                );
                            verificationIdentity = streamIdentity;
                            pendingRequestGeneration += 1;
                            if (changed) pending.value = [];
                            void fetchPending();
                            return;
                        }
                        if (!streamIdentityEstablished) {
                            throw new Error("验证事件流尚未声明实例身份");
                        }
                        if (isClearEvent(payload)) {
                            applyClear(payload);
                            return;
                        }
                        if (!isVerificationRequest(payload)) {
                            throw new Error("验证事件流包含无效请求");
                        }
                        // 新请求与同 key 刷新（如二维码过期换码）都打开抽屉并更新 UI
                        pending.value = mergePending(pending.value, payload);
                        shouldOpenDrawer.value = true;
                    } catch (error) {
                        reportClientError("解析验证事件失败", error);
                    }
                },
                onError: error => reportClientError("验证事件流连接失败", error),
                retryMs: 5_000,
            },
        );
    };

    const dismiss = (req: VerificationRequest) => {
        pending.value = pending.value.filter(
            r =>
                !(
                    r.platform === req.platform &&
                    r.account_id === req.account_id &&
                    r.type === req.type
                ),
        );
    };

    /** 请求向密保手机发送短信验证码（仅当 request.requestSmsAvailable 时展示按钮并调用） */
    const requestSms = async (
        platform: string,
        account_id: string,
    ): Promise<{ success: boolean; message?: string }> => {
        const identity = verificationIdentity;
        if (!identity) return { success: false, message: "无法确认待处理验证所属实例" };
        try {
            const response = await authFetch(buildApiUrl("/api/verification/request-sms"), {
                method: "POST",
                headers: verificationMutationHeaders(identity),
                body: JSON.stringify({ platform, account_id }),
            });
            return await readVerificationMutationResult(response, identity);
        } catch (error) {
            reportClientError("请求短信验证码失败", error);
            return {
                success: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    };

    const submit = async (
        platform: string,
        account_id: string,
        type: string,
        data: Record<string, unknown>,
    ): Promise<{ success: boolean; message?: string }> => {
        const identity = verificationIdentity;
        if (!identity) return { success: false, message: "无法确认待处理验证所属实例" };
        try {
            const response = await authFetch(buildApiUrl("/api/verification/submit"), {
                method: "POST",
                headers: verificationMutationHeaders(identity),
                body: JSON.stringify({ platform, account_id, type, data }),
            });
            const result = await readVerificationMutationResult(response, identity);
            if (
                result.success &&
                verificationIdentity &&
                sameManagementEvidenceIdentity(verificationIdentity, identity)
            ) {
                dismiss({ platform, account_id, type, data } as VerificationRequest);
            }
            return result;
        } catch (error) {
            reportClientError("提交验证失败", error);
            return {
                success: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    };

    const cleanup = () => {
        verificationEventSource?.close();
        verificationEventSource = null;
    };

    onMounted(() => {
        fetchPending();
        connect();
    });

    onUnmounted(() => {
        cleanup();
    });

    const requestOpenDrawer = () => {
        shouldOpenDrawer.value = true;
    };

    const resetOpenDrawer = () => {
        shouldOpenDrawer.value = false;
    };

    return {
        pending,
        shouldOpenDrawer,
        fetchPending,
        connect,
        dismiss,
        submit,
        requestSms,
        requestOpenDrawer,
        resetOpenDrawer,
        cleanup,
    };
}
