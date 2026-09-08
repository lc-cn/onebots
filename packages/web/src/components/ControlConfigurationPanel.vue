<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import ControlConfigurationRepair from "./ControlConfigurationRepair.vue";
import ControlConfigurationFields from "./ControlConfigurationFields.vue";
import { useControlConfigurationPanel } from "./use-control-configuration-panel.js";
const props = defineProps<{ client: ControlClient }>();
const emit = defineEmits<{ applied: [] }>();
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
</script>
<template>
    <section class="border-t border-border pt-6 space-y-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 class="text-lg font-medium">账号与运行配置</h2>
                <p class="text-sm text-fg-secondary mt-1">
                    先编辑草稿，再校验和应用。管理认证不属于运行配置。
                </p>
            </div>
            <UiButton :disabled="busy" @click="reload">{{
                dirty ? "放弃本地修改并重读" : "重新读取配置"
            }}</UiButton>
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
        <p v-if="message" role="status" class="text-sm text-fg-secondary">{{ message }}</p>
        <ControlConfigurationRepair
            v-if="source?.state === 'damaged'"
            :source="source"
            :disabled="repairBlocked"
            @confirm="repair" />
        <p v-if="projection?.unknownPaths.length" class="text-sm text-amber-700">
            存在无法安全展示的字段，已在服务端保留。此页面不会用空值覆盖它们。
        </p>
        <div
            v-if="snapshot && (!draft || staleBase)"
            class="rounded-xl border border-border p-4 flex items-center justify-between gap-3">
            <p class="text-sm">读取到 {{ accounts.length }} 个账号。可创建草稿开始配置。</p>
            <UiButton
                variant="primary"
                :disabled="busy"
                @click="staleBase ? createFresh() : create()"
                >{{ staleBase ? "读取当前配置并创建新草稿" : "创建配置草稿" }}</UiButton
            >
        </div>
        <template v-if="draft">
            <p class="text-xs text-fg-tertiary">
                草稿 {{ draft.id }} · {{ dirty ? "有本地修改尚未保存" : "已保存" }}
            </p>
            <fieldset
                :disabled="locked || dirty"
                class="rounded-xl border border-border p-4 space-y-3">
                <legend class="px-2 text-sm font-medium">平台账号</legend>
                <div class="flex flex-wrap gap-2">
                    <select
                        v-model="platform"
                        aria-label="平台适配器"
                        class="rounded border border-border bg-surface px-3 py-2 text-sm">
                        <option value="">选择已安装平台</option>
                        <option v-for="name in adapters" :key="name" :value="name">
                            {{ name }}
                        </option>
                    </select>
                    <input
                        v-model="accountId"
                        aria-label="账号标识"
                        placeholder="账号标识，保留原始字符串"
                        class="rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <UiButton
                        :disabled="locked || dirty || !platform || !accountId"
                        @click="addAccount"
                        >添加空账号</UiButton
                    >
                </div>
                <p v-if="!adapters.length" class="text-sm text-fg-secondary">
                    尚未安装平台，请先在扩展安装中选择所需适配器。
                </p>
                <ul class="space-y-2">
                    <li
                        v-for="key in accounts"
                        :key="key"
                        class="flex items-center justify-between gap-2 text-sm">
                        <span>{{ key }}</span
                        ><UiButton :disabled="locked || dirty" @click="removeAccount(key)"
                            >从草稿删除</UiButton
                        >
                    </li>
                </ul>
            </fieldset>
            <fieldset
                :disabled="locked || dirty"
                class="rounded-xl border border-border p-4 space-y-3">
                <legend class="px-2 text-sm font-medium">协议出口（可选）</legend>
                <div class="flex flex-wrap gap-2">
                    <select
                        v-model="accountTarget"
                        aria-label="协议配置位置"
                        class="rounded border border-border bg-surface px-3 py-2 text-sm">
                        <option value="">协议默认值</option>
                        <option v-for="key in accounts" :key="key" :value="key">{{ key }}</option>
                    </select>
                    <select
                        v-model="protocol"
                        aria-label="输出协议"
                        class="rounded border border-border bg-surface px-3 py-2 text-sm">
                        <option value="">选择已安装协议</option>
                        <option v-for="name in protocols" :key="name" :value="name">
                            {{ name }}
                        </option>
                    </select>
                    <UiButton :disabled="locked || dirty || !protocol" @click="setProtocol(true)"
                        >添加配置</UiButton
                    ><UiButton :disabled="locked || dirty || !protocol" @click="setProtocol(false)"
                        >移除配置</UiButton
                    >
                </div>
                <p class="text-xs text-fg-secondary">
                    默认值不会自动为账号开启出口。账号协议需单独添加，应用后才生效。
                </p>
            </fieldset>
            <ControlConfigurationFields
                :groups="groups"
                :values="values"
                :modes="modes"
                :secret-states="draft.secretStates"
                :locked="locked"
                :list-locked="locked || dirty"
                @list="editList"
                @change="change"
                @mode="mode" />
            <div class="flex flex-wrap gap-3">
                <UiButton :disabled="locked || !dirty" @click="save">保存草稿</UiButton>
                <UiButton :disabled="locked || dirty" @click="validate">校验配置</UiButton>
                <UiButton
                    variant="primary"
                    :disabled="locked || dirty || !validation?.valid"
                    @click="apply"
                    >应用已校验配置</UiButton
                >
            </div>
            <div v-if="validation" role="status" class="text-sm">
                <p>
                    {{
                        validation.valid
                            ? "校验通过，尚未应用。应用时会保持原有启停意图。"
                            : "校验未通过，请修改以下字段。"
                    }}
                </p>
                <ul class="mt-2 space-y-1">
                    <li v-for="(issue, index) in validation.issues" :key="index">
                        {{ issue.path.join(" / ") || "配置" }}：{{ issue.message }}
                    </li>
                </ul>
            </div>
        </template>
        <div
            v-if="tracking.operationId"
            class="rounded-xl border border-border p-4 space-y-3 text-sm">
            <p>应用操作 {{ tracking.operationId }}</p>
            <p>
                {{
                    operation?.status === "succeeded"
                        ? "应用成功"
                        : operation?.recoveryRequired
                          ? "需要人工对账，已停止自动恢复"
                          : operation?.rolledBack
                            ? "应用失败，已恢复原配置"
                            : operation?.status === "running"
                              ? "正在应用"
                              : "应用结果待确认"
                }}
            </p>
            <UiButton :disabled="busy" @click="query">查询原操作</UiButton>
            <UiButton
                v-if="operation && operation.status !== 'running' && !operation.recoveryRequired"
                :disabled="busy"
                @click="createFresh"
                >读取当前配置并创建新草稿</UiButton
            >
        </div>
    </section>
</template>
