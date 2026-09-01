<script setup lang="ts">
import { ref, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { IconSettings, IconRefresh, IconCheck, IconPlus, IconDownload } from "@tabler/icons-vue";
import { buildApiUrl } from "../config";
import { authFetch } from "../composables/useAuth";
import {
    readManagementJsonResponse,
    readManagementResponseBody,
} from "../management-response.js";
import yaml from "js-yaml";
import UiButton from "../ui/UiButton.vue";
import UiCard from "../ui/UiCard.vue";
import UiTabs from "../ui/UiTabs.vue";
import UiTextarea from "../ui/UiTextarea.vue";
import UiAlert from "../ui/UiAlert.vue";
import { useToast } from "../ui/toast.js";
import { useConfirm } from "../ui/confirm.js";

import ConfigSchemaTab from "../components/config/ConfigSchemaTab.vue";
import ConfigStaticTab from "../components/config/ConfigStaticTab.vue";
import ConfigAccountsTab from "../components/config/ConfigAccountsTab.vue";
import AccountWizard from "../components/config/AccountWizard.vue";

import type { Schema, SchemaBundle, SchemaGroup, AccountRow } from "../components/config/types";
import type { SchemaLoadStatus } from "../components/config/account-adapter-selection.js";
import { isAccountWizardRequest } from "./bot-onboarding.js";
import { parseProtocolConfigurationRequest } from "./protocol-configuration-request.js";
import {
    assertConfigurationMutationAcknowledgement,
    parseConfigurationSnapshot,
    type ConfigurationMutationResult,
} from "../configuration-snapshot.js";
import {
    MANAGEMENT_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "../management-evidence-identity.js";
import {
    getValueByPath,
    deleteValueByPath,
    setValueByPath,
    resolveStructuredFieldDisplay,
    resolveSchemaFieldInitialValue,
    parseStructuredFieldValue,
    isSchemaFieldVisible,
    normalizeSchema,
    buildConfigGroups,
    extractAccountRows,
    protocolTitle,
} from "../components/config/utils";

const toast = useToast();
const { confirm } = useConfirm();
const route = useRoute();
const router = useRouter();

const tabs = [
    { key: "schema", label: "表单" },
    { key: "raw", label: "原始配置" },
    { key: "static", label: "站点静态" },
    { key: "accounts", label: "账号" },
];

const config = ref<string>("");
const configurationIdentity = ref<ManagementEvidenceIdentity | null>(null);
const configRevision = ref("");
const configurationStatus = ref<"loading" | "ready" | "unavailable">("loading");
const configurationError = ref("");
const activeTab = ref<string>("schema");
const schema = ref<SchemaBundle | null>(null);
const schemaStatus = ref<SchemaLoadStatus>("loading");
const schemaGroups = ref<SchemaGroup[]>([]);
const activeGroups = ref<string[]>([]);
const formModel = reactive<Record<string, unknown>>({});

const accounts = ref<AccountRow[]>([]);
const accountEmptyText = ref("暂无账号");
const protocolConfigurationHint = ref("");
const saving = ref(false);
let configurationLoadGeneration = 0;

const staticTabRef = ref<InstanceType<typeof ConfigStaticTab>>();
const accountWizardRef = ref<InstanceType<typeof AccountWizard>>();

const applyProtocolConfigurationRequest = async () => {
    if (schemaStatus.value !== "ready" || route.query.protocol === undefined) return;
    const requestedProtocol = parseProtocolConfigurationRequest(
        route.query.protocol,
        Object.keys(schema.value?.protocols ?? {}),
    );
    const query = { ...route.query };
    delete query.protocol;
    await router.replace({ query });
    if (!requestedProtocol) {
        toast.warning("请求配置的开放协议未加载");
        return;
    }
    activeTab.value = "accounts";
    protocolConfigurationHint.value = requestedProtocol;
};

const syncFormModel = (configObject: Record<string, unknown>) => {
    schemaGroups.value.forEach(group => {
        group.fields.forEach(field => {
            const currentValue = getValueByPath(configObject, field.path);
            if (field.rule.type === "object" || field.rule.type === "array") {
                formModel[field.key] = resolveStructuredFieldDisplay(currentValue, field.rule);
                return;
            }
            formModel[field.key] = resolveSchemaFieldInitialValue(configObject, field);
        });
    });
};

const rebuildGroups = (configObject: Record<string, unknown>) => {
    if (!schema.value) {
        schemaGroups.value = [];
        return;
    }
    const groups = buildConfigGroups(schema.value);
    schemaGroups.value = groups;
    activeGroups.value = groups.filter(group => group.key === "base").map(group => group.key);
};

const parseConfigObject = (content: string): Record<string, unknown> => {
    const value: unknown = yaml.load(content);
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error("配置根节点必须是对象");
    }
    return value as Record<string, unknown>;
};

const refreshAccounts = (configObject = parseConfigObject(config.value)) => {
    const rows = extractAccountRows(configObject);
    accounts.value = rows;
    accountEmptyText.value = rows.length ? "" : "暂无账号";
};

const loadConfigurationSnapshot = async () => {
    const generation = ++configurationLoadGeneration;
    configurationStatus.value = "loading";
    schemaStatus.value = "loading";
    try {
        const requestOptions = { cache: "no-store" as const, signal: AbortSignal.timeout(5_000) };
        const [configResponse, schemaResponse] = await Promise.all([
            authFetch(buildApiUrl("/api/config"), requestOptions),
            authFetch(buildApiUrl("/api/config/schema"), requestOptions),
        ]);
        if (!configResponse.ok || !schemaResponse.ok) {
            throw new Error(
                `配置快照请求失败（配置 HTTP ${configResponse.status}，Schema HTTP ${schemaResponse.status}）`,
            );
        }
        const [content, rawSchema] = await Promise.all([
            readManagementResponseBody(configResponse),
            readManagementJsonResponse(schemaResponse),
        ]);
        const snapshot = parseConfigurationSnapshot(
            configResponse,
            schemaResponse,
            content,
            normalizeSchema(rawSchema as Schema | SchemaBundle),
        );
        const configObject = parseConfigObject(snapshot.content);
        if (generation !== configurationLoadGeneration) return;

        configurationIdentity.value = snapshot.identity;
        configRevision.value = snapshot.configRevision;
        config.value = snapshot.content;
        schema.value = snapshot.schema;
        rebuildGroups(configObject);
        refreshAccounts(configObject);
        if (schemaGroups.value.length) syncFormModel(configObject);
        configurationStatus.value = "ready";
        configurationError.value = "";
        schemaStatus.value = "ready";
        await applyProtocolConfigurationRequest();
    } catch (error) {
        if (generation !== configurationLoadGeneration) return;
        configurationIdentity.value = null;
        configRevision.value = "";
        configurationStatus.value = "unavailable";
        configurationError.value = error instanceof Error ? error.message : "配置快照加载失败";
        schemaStatus.value = "error";
        console.error("加载配置快照失败:", error);
        toast.error("加载配置快照失败");
    }
};

const handleReload = () => {
    toast.info("正在重新读取配置...");
    void loadConfigurationSnapshot();
};

const handleDownloadConfig = async () => {
    try {
        const expectedIdentity = configurationIdentity.value;
        if (!expectedIdentity) throw new Error("配置快照不可用，请重新读取");
        const response = await authFetch(buildApiUrl("/api/config"), { cache: "no-store" });
        if (!response.ok) throw new Error("获取配置失败");
        const responseIdentity = parseManagementEvidenceIdentity(response);
        if (!sameManagementEvidenceIdentity(responseIdentity, expectedIdentity)) {
            throw new Error("在线实例已切换，请重新读取配置后再下载");
        }
        const responseRevision =
            response.headers.get(MANAGEMENT_CONFIG_REVISION_HEADER)?.trim() ?? "";
        if (responseRevision !== configRevision.value) {
            throw new Error("在线配置已经更新，请重新读取后再下载");
        }
        const text = await readManagementResponseBody(response);
        const blob = new Blob([text], { type: "application/yaml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `config.yaml`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("已下载 config.yaml");
    } catch (error) {
        toast.error((error as Error).message || "下载失败");
    }
};

const handleSave = async () => {
    if (saving.value) return;
    const expectedIdentity = configurationIdentity.value;
    const expectedRevision = configRevision.value;
    if (!expectedIdentity || !expectedRevision) {
        toast.error("配置快照不可用，请重新读取后再保存");
        return;
    }
    saving.value = true;
    try {
        if (activeTab.value === "schema") {
            const configObject = parseConfigObject(config.value);
            for (const group of schemaGroups.value) {
                for (const field of group.fields) {
                    if (!isSchemaFieldVisible(field, formModel)) {
                        deleteValueByPath(configObject, field.path);
                        continue;
                    }
                    let value = formModel[field.key];
                    if (field.rule.type === "object" || field.rule.type === "array") {
                        const parsed = parseStructuredFieldValue(value, field.rule, field.label);
                        if (!parsed.ok) {
                            toast.error(parsed.message);
                            return;
                        }
                        value = parsed.value;
                    }
                    setValueByPath(configObject, field.path, value);
                }
            }
            config.value = yaml.dump(configObject, { lineWidth: 120 });
        }
        const response = await authFetch(buildApiUrl("/api/config"), {
            method: "POST",
            headers: {
                "Content-Type": "text/plain",
                [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: expectedIdentity.instanceId,
                [MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER]: expectedRevision,
            },
            body: config.value,
        });
        const result = (await readManagementJsonResponse(
            response,
        )) as ConfigurationMutationResult;
        if (response.ok) {
            assertConfigurationMutationAcknowledgement(result, expectedIdentity.instanceId);
            configRevision.value = result.config_revision as string;
            const message = typeof result.message === "string" ? result.message : undefined;
            if (result.restartRequired) toast.warning(message ?? "配置已保存，需要重启");
            else toast.success(message ?? "配置已保存并生效");
        } else {
            toast.error(typeof result.message === "string" ? result.message : "保存失败");
        }
    } catch (error) {
        console.error("保存配置失败:", error);
        toast.error(error instanceof Error ? error.message : "保存配置失败");
    } finally {
        saving.value = false;
    }
};

const handleRemoveAccount = async (row: AccountRow) => {
    const ok = await confirm({
        title: "提示",
        message: `确认删除账号 ${row.platform}.${row.account_id} 吗？`,
        confirmText: "删除",
        danger: true,
    });
    if (!ok) return;

    const url = buildApiUrl(
        `/api/remove?platform=${encodeURIComponent(row.platform)}&uin=${encodeURIComponent(row.account_id)}`,
    );
    const expectedIdentity = configurationIdentity.value;
    const expectedRevision = configRevision.value;
    if (!expectedIdentity || !expectedRevision) {
        toast.error("配置快照不可用，请重新读取后再删除账号");
        return;
    }
    try {
        const response = await authFetch(url, {
            headers: {
                [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: expectedIdentity.instanceId,
                [MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER]: expectedRevision,
            },
        });
        if (response.ok) {
            toast.success("删除成功");
            await loadConfigurationSnapshot();
        } else {
            const result = (await readManagementJsonResponse(response)) as { message?: string };
            toast.error(result.message || "删除失败");
        }
    } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除失败");
    }
};

onMounted(async () => {
    await loadConfigurationSnapshot();
    const requestedPlatform = route.query.add;
    if (isAccountWizardRequest(requestedPlatform, Object.keys(schema.value?.adapters ?? {}))) {
        activeTab.value = "accounts";
        accountWizardRef.value?.openAdd(requestedPlatform);
        const query = { ...route.query };
        delete query.add;
        await router.replace({ query });
    }
});

watch(activeTab, name => {
    if (name === "static") staticTabRef.value?.refresh();
});
</script>

<template>
    <div class="h-full overflow-y-auto">
        <div class="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
            <header
                class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <h2 class="flex items-center gap-2 text-lg font-semibold text-fg">
                    <IconSettings :size="20" aria-hidden="true" />
                    配置管理
                </h2>
                <div class="flex flex-wrap items-center gap-2">
                    <UiButton
                        variant="primary"
                        :disabled="configurationStatus !== 'ready'"
                        @click="accountWizardRef?.openAdd()">
                        <IconPlus :size="16" aria-hidden="true" />
                        新增账号
                    </UiButton>
                    <UiButton
                        variant="secondary"
                        :disabled="configurationStatus !== 'ready'"
                        @click="handleDownloadConfig">
                        <IconDownload :size="16" aria-hidden="true" />
                        下载当前配置
                    </UiButton>
                    <UiButton variant="secondary" @click="handleReload">
                        <IconRefresh :size="16" aria-hidden="true" />
                        重新读取
                    </UiButton>
                    <UiButton
                        variant="primary"
                        :disabled="saving || configurationStatus !== 'ready'"
                        @click="handleSave">
                        <IconCheck :size="16" aria-hidden="true" />
                        {{ saving ? "正在应用…" : "保存并应用" }}
                    </UiButton>
                </div>
            </header>

            <UiAlert
                v-if="configurationStatus !== 'ready'"
                class="mb-4"
                :variant="configurationStatus === 'loading' ? 'info' : 'danger'"
                :title="configurationStatus === 'loading' ? '正在验证配置快照' : '配置快照不可用'">
                {{
                    configurationStatus === "loading"
                        ? "正在读取同一 OneBots 实例的配置正文与 Schema。"
                        : configurationError
                }}
            </UiAlert>

            <UiCard v-if="configurationStatus === 'ready'">
                <UiTabs v-model="activeTab" :tabs="tabs" />

                <ConfigSchemaTab
                    v-if="activeTab === 'schema'"
                    :schema-groups="schemaGroups"
                    :form-model="formModel"
                    v-model:active-groups="activeGroups" />

                <div v-else-if="activeTab === 'raw'" class="pt-4">
                    <UiTextarea v-model="config" mono :rows="24" placeholder="配置内容" />
                </div>

                <ConfigStaticTab v-else-if="activeTab === 'static'" ref="staticTabRef" />

                <template v-else-if="activeTab === 'accounts'">
                    <UiAlert
                        v-if="protocolConfigurationHint"
                        class="mt-4"
                        variant="info"
                        closable
                        :title="`配置 ${protocolTitle(protocolConfigurationHint)} 账号出口`"
                        @close="protocolConfigurationHint = ''">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span>新增账号会预选该协议；编辑已有账号会直接定位并启用。</span>
                            <UiButton
                                size="sm"
                                variant="secondary"
                                @click="accountWizardRef?.openAdd('', protocolConfigurationHint)">
                                新增账号并启用
                            </UiButton>
                        </div>
                    </UiAlert>
                    <ConfigAccountsTab
                        :accounts="accounts"
                        :account-empty-text="accountEmptyText"
                        @edit="row => accountWizardRef?.openEdit(row, protocolConfigurationHint)"
                        @remove="handleRemoveAccount" />
                </template>
            </UiCard>
        </div>
    </div>

    <AccountWizard
        ref="accountWizardRef"
        :schema="schema"
        :schema-status="schemaStatus"
        :instance-id="configurationIdentity?.instanceId"
        :config-revision="configRevision"
        @saved="loadConfigurationSnapshot"
        @reload-schema="loadConfigurationSnapshot" />
</template>
