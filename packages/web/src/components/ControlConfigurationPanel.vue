<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
    IconAdjustments,
    IconArrowRight,
    IconCheck,
    IconPlugConnected,
    IconRobot,
} from "@tabler/icons-vue";
import type { ControlClient } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import ControlConfigurationRepair from "./ControlConfigurationRepair.vue";
import ControlConfigurationSections from "./ControlConfigurationSections.vue";
import { useControlConfigurationPanel } from "./use-control-configuration-panel.js";
import type { ControlMutationBlock } from "../control-product-state.js";
import {
    configurationGroupLayout,
    configurationNextAction,
    configurationWorkspaceForPath,
    type ConfigurationWorkspace,
} from "./control-configuration-layout.js";

const props = defineProps<{ client: ControlClient; mutationBlock?: ControlMutationBlock }>();
const emit = defineEmits<{ applied: []; dirtyChange: [dirty: boolean] }>();
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

const workspace = ref<ConfigurationWorkspace>("accounts");
const workspaceTabs = ref<HTMLButtonElement[]>([]);
const layout = computed(() => configurationGroupLayout(groups.value));
const validationIssuePath = computed(() =>
    validation.value?.valid === false ? validation.value.issues[0]?.path : undefined,
);
const pendingOperation = computed(
    () =>
        Boolean(tracking.value.operationId) &&
        (!operation.value ||
            operation.value.status === "running" ||
            operation.value.recoveryRequired),
);
const nextAction = computed(() =>
    configurationNextAction({
        dirty: dirty.value,
        validation:
            validation.value?.valid === true
                ? "valid"
                : validation.value?.valid === false
                  ? "invalid"
                  : "missing",
        operation: pendingOperation.value
            ? "pending"
            : tracking.value.operationId
              ? "resolved"
              : "none",
        issueCount: validation.value?.issues.length,
        issueWorkspace: validation.value?.issues[0]
            ? configurationWorkspaceForPath(validation.value.issues[0].path, protocols.value)
            : undefined,
    }),
);
const structuralActionBlockReason = computed(() => {
    if (props.mutationBlock) return `${props.mutationBlock.title}，结构修改暂不可用。`;
    if (tracking.value.operationId) return "已有应用操作，请先在“确认应用”中处理。";
    if (busy.value) return "正在处理上一项操作，请稍候。";
    if (dirty.value) return "请先保存当前字段修改，再调整账号或协议结构。";
    if (locked.value) return "当前配置来源不可用，结构修改保持只读。";
    return "";
});
const nextActionDisabled = computed(() => {
    if (nextAction.value.action === "query" || nextAction.value.action === "fix") return busy.value;
    return busy.value || locked.value || Boolean(props.mutationBlock);
});
const workspaces = computed(() => [
    {
        id: "accounts" as const,
        label: "平台账号",
        detail: `${accounts.value.length} 个账号`,
        icon: IconRobot,
    },
    {
        id: "protocols" as const,
        label: "协议出口",
        detail: `${layout.value.protocols.length} 项配置`,
        icon: IconPlugConnected,
    },
    {
        id: "runtime" as const,
        label: "运行设置",
        detail: "服务与加载参数",
        icon: IconAdjustments,
    },
    {
        id: "review" as const,
        label: "确认应用",
        detail: nextAction.value.label,
        icon: IconCheck,
    },
]);

watch(dirty, value => emit("dirtyChange", value), { immediate: true, flush: "sync" });

function reloadWithConfirmation() {
    if (dirty.value && !window.confirm("重新读取会放弃尚未保存到草稿的本地修改，是否继续？"))
        return;
    void reload();
}
async function onWorkspaceKeydown(event: KeyboardEvent) {
    const current = workspaces.value.findIndex(item => item.id === workspace.value);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % workspaces.value.length;
    else if (event.key === "ArrowLeft")
        next = (current - 1 + workspaces.value.length) % workspaces.value.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = workspaces.value.length - 1;
    else return;
    event.preventDefault();
    workspace.value = workspaces.value[next].id;
    await nextTick();
    workspaceTabs.value[next]?.focus();
}
async function runNextAction() {
    workspace.value = nextAction.value.workspace;
    if (nextAction.value.action === "query") await query();
    else if (nextAction.value.action === "save") await save();
    else if (nextAction.value.action === "validate") await validate();
    else if (nextAction.value.action === "apply") await apply();
    else if (nextAction.value.action === "new-draft") await createFresh();
    else if (nextAction.value.action === "fix" && validationIssuePath.value) {
        await nextTick();
        const key = JSON.stringify(validationIssuePath.value);
        const field = Array.from(
            document.querySelectorAll<HTMLElement>("[data-configuration-path]"),
        ).find(element => element.dataset.configurationPath === key);
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
        field?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    }
}
</script>

<template>
    <section class="configuration-workspace">
        <header class="configuration-header">
            <div>
                <h2>配置草稿</h2>
                <p>先编辑配置，再依次保存、校验和应用。运行中的版本不会被直接覆盖。</p>
            </div>
            <UiButton :disabled="busy" @click="reloadWithConfirmation">{{
                dirty ? "放弃修改并重读" : "重新读取"
            }}</UiButton>
        </header>

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
            <div>
                <h3>当前有 {{ accounts.length }} 个平台账号</h3>
                <p>创建草稿后才能编辑；创建动作不会改变正在运行的网关。</p>
            </div>
            <UiButton
                variant="primary"
                :disabled="busy || !!mutationBlock"
                @click="staleBase ? createFresh() : create()"
                >{{ staleBase ? "基于当前配置重建草稿" : "开始配置" }}</UiButton
            >
        </div>

        <template v-if="draft">
            <div class="configuration-draft-status">
                <span
                    ><i :class="{ changed: dirty }"></i
                    >{{ dirty ? "有本地修改" : "草稿已保存" }}</span
                >
                <code>{{ draft.id }}</code>
            </div>

            <nav
                class="configuration-steps"
                role="tablist"
                aria-label="账号与协议配置步骤"
                @keydown="onWorkspaceKeydown">
                <button
                    v-for="item in workspaces"
                    ref="workspaceTabs"
                    :id="`configuration-tab-${item.id}`"
                    :key="item.id"
                    type="button"
                    role="tab"
                    :aria-selected="workspace === item.id"
                    :aria-controls="`configuration-panel-${item.id}`"
                    :tabindex="workspace === item.id ? 0 : -1"
                    :class="{ active: workspace === item.id }"
                    @click="workspace = item.id">
                    <component :is="item.icon" :size="18" aria-hidden="true" />
                    <div>
                        <strong>{{ item.label }}</strong
                        ><small>{{ item.detail }}</small>
                    </div>
                </button>
            </nav>

            <ControlConfigurationSections
                v-model:platform="platform"
                v-model:account-id="accountId"
                v-model:account-target="accountTarget"
                v-model:protocol="protocol"
                :workspace="workspace"
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
                :reveal-path="nextAction.action === 'fix' ? validationIssuePath : undefined"
                @add-account="addAccount"
                @remove-account="removeAccount"
                @set-protocol="setProtocol"
                @list="editList"
                @change="change"
                @mode="mode" />

            <section
                v-show="workspace === 'review'"
                id="configuration-panel-review"
                role="tabpanel"
                aria-labelledby="configuration-tab-review"
                class="configuration-step-panel review">
                <header class="configuration-step-heading">
                    <div>
                        <span>步骤 4</span>
                        <h3>校验并应用</h3>
                    </div>
                    <p>先保存浏览器中的字段修改，再校验完整配置，最后显式应用。</p>
                </header>
                <div class="configuration-review-summary">
                    <div>
                        <span>平台账号</span><strong>{{ accounts.length }}</strong
                        ><small>{{ accounts.length ? "已建立平台身份" : "尚未配置账号" }}</small>
                    </div>
                    <div>
                        <span>协议配置</span><strong>{{ layout.protocols.length }}</strong
                        ><small>含全局默认与账号出口</small>
                    </div>
                    <div>
                        <span>草稿状态</span
                        ><strong>{{
                            dirty ? "待保存" : validation?.valid ? "已通过" : "待校验"
                        }}</strong
                        ><small>应用前不会影响运行配置</small>
                    </div>
                </div>
                <ol class="configuration-lifecycle" aria-label="配置提交状态">
                    <li :class="{ active: dirty, complete: !dirty }">
                        <span>1</span>
                        <div><strong>保存草稿</strong><small>把本地字段写入服务端草稿</small></div>
                    </li>
                    <li
                        :class="{
                            active: !dirty && !validation?.valid,
                            complete: !!validation?.valid,
                            invalid: validation?.valid === false,
                        }">
                        <span>2</span>
                        <div><strong>校验配置</strong><small>检查必填项和连接参数</small></div>
                    </li>
                    <li
                        :class="{
                            active: !!validation?.valid && !tracking.operationId,
                            complete: operation?.status === 'succeeded',
                        }">
                        <span>3</span>
                        <div><strong>应用版本</strong><small>保持网关原有启停意图</small></div>
                    </li>
                </ol>
                <div
                    v-if="validation"
                    :role="validation.valid ? 'status' : 'alert'"
                    :class="['configuration-validation', validation.valid ? 'success' : 'danger']">
                    <strong>{{
                        validation.valid
                            ? "校验通过，可以应用"
                            : `发现 ${validation.issues.length} 个问题`
                    }}</strong>
                    <p>
                        {{
                            validation.valid
                                ? "应用会创建新的配置版本；网关原本停止时仍保持停止。"
                                : "返回对应模块修正后，先保存草稿，再重新校验。"
                        }}
                    </p>
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

            <footer class="configuration-action-bar">
                <div>
                    <span>下一步</span><strong>{{ nextAction.label }}</strong
                    ><small>{{ nextAction.detail }}</small>
                </div>
                <UiButton variant="primary" :disabled="nextActionDisabled" @click="runNextAction"
                    >{{ nextAction.label }}<IconArrowRight :size="16" aria-hidden="true"
                /></UiButton>
            </footer>
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
