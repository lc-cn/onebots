<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import { IconRefresh } from "@tabler/icons-vue";
import type { ControlClient } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import UiInfoTip from "../ui/UiInfoTip.vue";
import ControlConfigurationRepair from "./ControlConfigurationRepair.vue";
import ControlConfigurationSections from "./ControlConfigurationSections.vue";
import { useControlConfigurationPanel } from "./use-control-configuration-panel.js";
import type { ControlMutationBlock } from "../control-product-state.js";
import {
    configurationWorkspaceForPath,
    type ConfigurationNavigationTarget,
    type ConfigurationScope,
} from "./control-configuration-layout.js";

const props = defineProps<{
    client: ControlClient;
    mutationBlock?: ControlMutationBlock;
    gatewayRunning?: boolean;
    target?: ConfigurationNavigationTarget;
    scope: ConfigurationScope;
}>();
const emit = defineEmits<{
    applied: [];
    dirtyChange: [dirty: boolean];
    selectExtensions: [];
    selectAccounts: [];
    navigateScope: [scope: ConfigurationScope];
    close: [];
}>();
const {
    source,
    repair,
    repairBlocked,
    snapshot,
    draft,
    validation,
    operation,
    tracking,
    values,
    modes,
    busy,
    staleBase,
    message,
    error,
    platform,
    accountId,
    accountTarget,
    protocol,
    projection,
    adapters,
    protocols,
    accounts,
    groups,
    dirty,
    locked,
    reload,
    createFresh,
    create,
    save,
    addAccount,
    removeAccount,
    setProtocol,
    editList,
    validate,
    query,
    apply,
    change,
    mode,
} = useControlConfigurationPanel(props.client, () => emit("applied"));

const scopeTitle: Record<ConfigurationScope, string> = {
    accounts: "账号配置",
    protocols: "协议配置",
    runtime: "运行设置",
};
const structuralActionBlockReason = computed(() => {
    if (props.mutationBlock) return `${props.mutationBlock.title}，结构修改暂不可用。`;
    if (tracking.value.operationId) return "已有应用操作，请先在“确认应用”中处理。";
    if (busy.value) return "正在处理上一项操作，请稍候。";
    if (dirty.value) return "请先保存当前字段修改，再调整账号或协议结构。";
    if (locked.value) return "当前配置来源不可用，结构修改保持只读。";
    return "";
});

watch(dirty, value => emit("dirtyChange", value), { immediate: true, flush: "sync" });
let appliedRemovalRevision = 0;
let attemptedRemovalDraftRevision = 0;
watch(
    () =>
        [
            props.target?.revision,
            props.target?.action,
            draft.value?.id,
            snapshot.value?.base,
            busy.value,
        ] as const,
    async () => {
        const target = props.target;
        if (target?.action !== "remove" || target.revision === appliedRemovalRevision || busy.value)
            return;
        if (!draft.value) {
            if (
                snapshot.value &&
                !props.mutationBlock &&
                !tracking.value.operationId &&
                attemptedRemovalDraftRevision !== target.revision
            ) {
                attemptedRemovalDraftRevision = target.revision;
                await create();
            }
            return;
        }
        appliedRemovalRevision = target.revision;
        if (props.mutationBlock || dirty.value || tracking.value.operationId) {
            error.value = "当前有未保存修改或操作进行中，请先处理，再重试删除。";
            return;
        }
        if (target.protocolKey) {
            accountTarget.value = `${target.platform}.${target.accountId}`;
            protocol.value = target.protocolKey;
            await setProtocol(false);
        } else {
            await removeAccount(`${target.platform}.${target.accountId}`);
        }
    },
    { immediate: true },
);

function reloadWithConfirmation() {
    if (dirty.value && !window.confirm("重新读取会放弃尚未保存到草稿的本地修改，是否继续？"))
        return;
    void reload();
}
async function checkConfiguration() {
    if (dirty.value && !(await save())) return false;
    const result = await validate();
    if (!result?.valid && result?.issues[0]) {
        const issueScope = configurationWorkspaceForPath(result.issues[0].path, protocols.value);
        if (issueScope !== "review" && issueScope !== props.scope)
            emit("navigateScope", issueScope);
        await nextTick();
        const key = JSON.stringify(result.issues[0].path);
        const field = Array.from(
            document.querySelectorAll<HTMLElement>("[data-configuration-path]"),
        ).find(element => element.dataset.configurationPath === key);
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
        field?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    }
    return result?.valid === true;
}
async function saveConfiguration() {
    if (tracking.value.operationId) {
        await query();
        return;
    }
    if (props.gatewayRunning && !window.confirm("保存设置可能短暂中断账号和协议连接，继续吗？"))
        return;
    if (!(await checkConfiguration())) return;
    await apply();
}
</script>

<template>
    <section class="configuration-workspace">
        <header class="configuration-header">
            <h2>
                {{ scopeTitle[scope] }}
                <UiInfoTip
                    label="配置说明"
                    text="检测会检查同一份配置草稿；保存会应用配置，运行中的连接可能短暂中断。" />
            </h2>
            <div class="configuration-header-controls">
                <UiButton
                    v-if="scope !== 'accounts'"
                    variant="ghost"
                    size="sm"
                    @click="emit('selectAccounts')">
                    查看账号状态
                </UiButton>
                <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="busy || !!tracking.operationId"
                    @click="emit('close')"
                    >收起编辑</UiButton
                >
            </div>
        </header>
        <div
            class="workspace-action-bar configuration-header-actions"
            role="toolbar"
            aria-label="配置操作">
            <span class="workspace-action-context">{{
                dirty ? "有未保存的修改" : scopeTitle[scope]
            }}</span>
            <UiButton
                class="workspace-action-refresh"
                aria-label="刷新配置"
                :disabled="busy"
                @click="reloadWithConfirmation"
                ><IconRefresh :size="16" aria-hidden="true" /><span>刷新</span></UiButton
            >
            <UiButton
                v-if="draft"
                :disabled="busy || !draft || !!mutationBlock || !!tracking.operationId"
                @click="checkConfiguration"
                >检测</UiButton
            >
            <UiButton
                v-if="draft"
                variant="primary"
                :disabled="busy || !draft || !!mutationBlock || !!tracking.operationId"
                :loading="busy"
                @click="saveConfiguration"
                >保存</UiButton
            >
        </div>

        <div v-if="error" role="alert" class="configuration-banner danger">{{ error }}</div>
        <div v-if="mutationBlock" role="alert" class="configuration-banner danger">
            <strong>{{ mutationBlock.title }}</strong
            ><span>配置保持只读；可以重新读取和查询已有操作。</span>
        </div>
        <ControlConfigurationRepair
            v-if="source?.state === 'damaged'"
            :source="source"
            :disabled="repairBlocked || !!mutationBlock"
            @confirm="repair" />
        <div v-if="projection?.unknownPaths.length" class="configuration-banner warning">
            <strong>部分字段由服务端保护</strong
            ><span>无法安全展示的内容会原样保留，本页面不会用空值覆盖。</span>
        </div>
        <p v-if="message" role="status" class="configuration-message">{{ message }}</p>

        <div
            v-if="snapshot && (!draft || staleBase) && !tracking.operationId"
            class="configuration-start-card">
            <h2>
                {{
                    staleBase
                        ? "配置已有更新"
                        : scope === "runtime"
                          ? "当前运行设置"
                          : scope === "protocols"
                            ? "当前协议配置"
                            : accounts.length
                              ? "当前账号配置"
                              : "还没有账号"
                }}
            </h2>
            <UiButton
                variant="primary"
                :disabled="busy || !!mutationBlock"
                @click="staleBase ? createFresh() : create()"
                >{{
                    staleBase ? "读取最新配置" : accounts.length ? "编辑配置" : "开始配置"
                }}</UiButton
            >
        </div>

        <template v-if="draft">
            <div class="configuration-draft-status">
                <span
                    ><i :class="{ changed: dirty }"></i
                    >{{ dirty ? "有未保存的修改" : "设置已同步" }}</span
                >
                <span v-if="operation?.status === 'running'">正在更新运行设置</span>
            </div>

            <ControlConfigurationSections
                v-model:platform="platform"
                v-model:account-id="accountId"
                v-model:account-target="accountTarget"
                v-model:protocol="protocol"
                :workspace="scope"
                :groups="groups"
                :values="values"
                :modes="modes"
                :secret-states="draft.secretStates"
                :adapters="adapters"
                :protocols="protocols"
                :accounts="accounts"
                :dirty="dirty"
                :locked="locked || !!mutationBlock"
                :action-block-reason="structuralActionBlockReason"
                :reveal-path="validation?.valid === false ? validation.issues[0]?.path : undefined"
                :navigation-target="target"
                @add-account="addAccount"
                @remove-account="removeAccount"
                @set-protocol="setProtocol"
                @list="editList"
                @change="change"
                @mode="mode"
                @select-extensions="emit('selectExtensions')" />

            <section
                v-if="validation || tracking.operationId"
                class="configuration-step-panel review"
                aria-label="配置检查结果">
                <div
                    v-if="validation"
                    :role="validation.valid ? 'status' : 'alert'"
                    :class="['configuration-validation', validation.valid ? 'success' : 'danger']">
                    <strong>{{
                        validation.valid ? "检测通过" : `发现 ${validation.issues.length} 个问题`
                    }}</strong>
                    <ul v-if="!validation.valid">
                        <li v-for="(issue, index) in validation.issues" :key="index">
                            {{ issue.path.join(" / ") || "配置" }}：{{ issue.message }}
                        </li>
                    </ul>
                </div>
                <div v-if="tracking.operationId" class="configuration-operation">
                    <div>
                        <span>应用操作</span><code>{{ tracking.operationId }}</code
                        ><strong>{{
                            operation?.status === "succeeded"
                                ? "应用成功"
                                : operation?.recoveryRequired
                                  ? "需要人工对账"
                                  : operation?.rolledBack
                                    ? "应用失败，已恢复原配置"
                                    : operation?.status === "running"
                                      ? "正在应用"
                                      : "应用结果待确认"
                        }}</strong>
                    </div>
                    <div>
                        <UiButton :disabled="busy" @click="query">查询原操作</UiButton
                        ><UiButton
                            v-if="
                                operation &&
                                operation.status !== 'running' &&
                                !operation.recoveryRequired
                            "
                            :disabled="busy || !!mutationBlock"
                            @click="createFresh"
                            >基于当前配置新建草稿</UiButton
                        >
                    </div>
                </div>
            </section>
        </template>
        <div v-if="!draft && tracking.operationId" class="configuration-operation standalone">
            <div>
                <span>正在恢复应用操作</span><code>{{ tracking.operationId }}</code
                ><strong>{{
                    operation?.status === "succeeded"
                        ? "应用成功"
                        : operation?.recoveryRequired
                          ? "需要人工对账"
                          : operation?.rolledBack
                            ? "应用失败，已恢复原配置"
                            : operation?.status === "running"
                              ? "正在应用"
                              : "应用结果待确认"
                }}</strong>
            </div>
            <UiButton :disabled="busy" @click="query">查询原操作</UiButton>
            <UiButton
                v-if="operation && operation.status !== 'running' && !operation.recoveryRequired"
                :disabled="busy || !!mutationBlock"
                @click="createFresh"
                >基于当前配置新建草稿</UiButton
            >
        </div>
    </section>
</template>
