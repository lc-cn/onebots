import path from "node:path";
import { appendControlLog, createControlLogWriter } from "./gateway-log.js";
import { createControlSnapshotResponder } from "./diagnostics.js";
import { ControlAuth } from "./auth.js";
import { GenerationStore } from "../installation/generation-store.js";
import { ControlNotificationService } from "./notification-service.js";
import { ChatHistoryStore } from "../chat-history-store.js";
import { controlDirectory } from "./workspace.js";
import { serviceMigrationStatus } from "./service-migration-api.js";
import { authenticationContext, type WorkspaceBinding } from "../workspace-admission/types.js";
import type { consumeDeploymentAuthenticationEnvironment } from "./auth-deployment.js";
import { WindowsManagerStatusPublisher } from "../windows-manager-status-publisher.js";
interface AdmittedHostStorage {
    controlLogs: ReturnType<typeof createControlLogWriter>;
    notifications: ControlNotificationService | undefined;
    chatHistory: ChatHistoryStore | undefined;
    observeOperation: ReturnType<typeof createControlLogWriter>["operation"];
    auth: ControlAuth | undefined;
    generations: GenerationStore | undefined;
    respondSnapshot: ReturnType<typeof createControlSnapshotResponder>;
    authAvailable: boolean;
    storageError: boolean;
}
export function createAdmittedHostStorage(input: {
    workspace: string;
    id: string;
    binding: WorkspaceBinding;
    ownershipAvailable: boolean;
    installDeploymentAuth: ReturnType<typeof consumeDeploymentAuthenticationEnvironment>;
    activeGenerationId(): string | undefined;
    release(): void;
}): AdmittedHostStorage {
    const {
        workspace,
        id,
        binding,
        ownershipAvailable,
        installDeploymentAuth,
        activeGenerationId,
        release,
    } = input;
    const controlLogs = (() => {
        try {
            return createControlLogWriter(workspace, id);
        } catch (error) {
            release();
            throw error;
        }
    })();
    let notifications: ControlNotificationService | undefined;
    let chatHistory: ChatHistoryStore | undefined;
    try {
        chatHistory = new ChatHistoryStore(
            path.join(workspace, "data", "chat-history.db"),
            error => {
                try {
                    appendControlLog(
                        workspace,
                        "manager",
                        `${JSON.stringify({ time: new Date().toISOString(), level: "error", event: "chat_history_prune_failed", message: String(error) })}\n`,
                    );
                } catch {
                    process.stderr.write("[onebots] 聊天历史过期清理失败，管理日志不可写\n");
                }
            },
        );
    } catch {
        process.stderr.write("[onebots] 聊天历史存储不可用，请检查工作区\n");
    }
    try {
        notifications = new ControlNotificationService(
            path.join(controlDirectory(workspace), "notifications"),
        );
    } catch {
        process.stderr.write("[onebots] 通知存储不可用，通知功能已停用，请检查工作区\n");
    }
    const observeOperation = (operation: Parameters<typeof controlLogs.operation>[0]) => {
        controlLogs.operation(operation);
        try {
            notifications?.observeOperation(operation);
        } catch {
            process.stderr.write("[onebots] 通知事件持久化失败\n");
        }
    };
    let auth: ControlAuth | undefined;
    let authAvailable = true;
    let storageError = !ownershipAvailable || serviceMigrationStatus(workspace).recoveryRequired;
    let generations: GenerationStore | undefined;
    try {
        generations = new GenerationStore({
            root: path.join(controlDirectory(workspace), "generations"),
            isActive: generationId => activeGenerationId() === generationId,
        });
    } catch {
        storageError = true;
        process.stderr.write("[onebots] 运行版本仓库不可读取，保持管理端用于诊断\n");
    }
    try {
        auth = new ControlAuth({
            statePath: path.join(controlDirectory(workspace), "auth.json"),
            bindingContext: authenticationContext(binding),
        });
        installDeploymentAuth?.(auth);
    } catch {
        authAvailable = false;
        process.stderr.write("[onebots] 控制认证存储不可用，远程管理已禁用\n");
    }
    const respondSnapshot = createControlSnapshotResponder(workspace, generations);
    return {
        controlLogs,
        notifications,
        chatHistory,
        observeOperation,
        auth,
        generations,
        respondSnapshot,
        authAvailable,
        storageError,
    };
}

export function createAdmittedWindowsPublisher(
    pipe: string,
    manager: { id: string; version: string; pid: number },
    workspace: string,
) {
    return new WindowsManagerStatusPublisher(pipe, manager, undefined, {
        onFailure: failure => {
            try {
                appendControlLog(
                    workspace,
                    "operation",
                    `${JSON.stringify({
                        time: new Date().toISOString(),
                        action: `windows-status.${failure.phase}`,
                        status: "failed",
                        code: failure.code,
                    })}\n`,
                );
            } catch {
                process.stderr.write("[onebots] Windows 状态失败诊断不可写\n");
            }
        },
    });
}
