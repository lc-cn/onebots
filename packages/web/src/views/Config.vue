<script setup lang="ts">
import { ref, onMounted, reactive, watch } from "vue";
import { IconSettings, IconRefresh, IconCheck, IconPlus, IconDownload } from "@tabler/icons-vue";
import { buildApiUrl } from "../config";
import { authFetch } from "../composables/useAuth";
import yaml from "js-yaml";
import UiButton from "../ui/UiButton.vue";
import UiCard from "../ui/UiCard.vue";
import UiTabs from "../ui/UiTabs.vue";
import UiTextarea from "../ui/UiTextarea.vue";
import { useToast } from "../ui/toast.js";
import { useConfirm } from "../ui/confirm.js";

import ConfigSchemaTab from "../components/config/ConfigSchemaTab.vue";
import ConfigStaticTab from "../components/config/ConfigStaticTab.vue";
import ConfigAccountsTab from "../components/config/ConfigAccountsTab.vue";
import AccountWizard from "../components/config/AccountWizard.vue";

import type { SchemaBundle, SchemaGroup, AccountRow } from "../components/config/types";
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
} from "../components/config/utils";

const toast = useToast();
const { confirm } = useConfirm();

const tabs = [
    { key: "schema", label: "表单" },
    { key: "raw", label: "原始配置" },
    { key: "static", label: "站点静态" },
    { key: "accounts", label: "账号" },
];

const config = ref<string>("");
const activeTab = ref<string>("schema");
const schema = ref<SchemaBundle | null>(null);
const schemaGroups = ref<SchemaGroup[]>([]);
const activeGroups = ref<string[]>([]);
const formModel = reactive<Record<string, unknown>>({});

const accounts = ref<AccountRow[]>([]);
const accountEmptyText = ref("暂无账号");
const saving = ref(false);

const staticTabRef = ref<InstanceType<typeof ConfigStaticTab>>();
const accountWizardRef = ref<InstanceType<typeof AccountWizard>>();

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

const refreshAccounts = () => {
    const configObject = (yaml.load(config.value) || {}) as Record<string, unknown>;
    const rows = extractAccountRows(configObject);
    accounts.value = rows;
    accountEmptyText.value = rows.length ? "" : "暂无账号";
};

const loadConfig = async () => {
    try {
        const response = await authFetch(buildApiUrl("/api/config"));
        if (response.ok) {
            config.value = await response.text();
            const configObject = (yaml.load(config.value) || {}) as Record<string, unknown>;
            rebuildGroups(configObject);
            refreshAccounts();
            if (schemaGroups.value.length) {
                syncFormModel(configObject);
            }
        }
    } catch (error) {
        console.error("加载配置失败:", error);
        toast.error("加载配置失败");
    }
};

const loadSchema = async () => {
    try {
        const response = await authFetch(buildApiUrl("/api/config/schema"));
        if (response.ok) {
            const rawSchema = await response.json();
            schema.value = normalizeSchema(rawSchema);
        }
    } catch (error) {
        console.error("加载配置 Schema 失败:", error);
    }
};

const handleReload = () => {
    toast.info("正在重新读取配置...");
    loadSchema();
    loadConfig();
};

const handleDownloadConfig = async () => {
    try {
        const response = await authFetch(buildApiUrl("/api/config"));
        if (!response.ok) throw new Error("获取配置失败");
        const text = await response.text();
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
    saving.value = true;
    try {
        if (activeTab.value === "schema") {
            const configObject = (yaml.load(config.value) || {}) as Record<string, unknown>;
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
            },
            body: config.value,
        });
        if (response.ok) {
            const result = await response.json();
            if (result.restartRequired) toast.warning(result.message || "配置已保存，需要重启");
            else toast.success(result.message || "配置已保存并生效");
        } else {
            const result = await response.json();
            toast.error(result.message || "保存失败");
        }
    } catch (error) {
        console.error("保存配置失败:", error);
        toast.error("保存配置失败");
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
    const response = await authFetch(url);
    if (response.ok) {
        toast.success("删除成功");
        await loadConfig();
    } else {
        const result = await response.json().catch(() => ({}));
        toast.error(result.message || "删除失败");
    }
};

onMounted(() => {
    loadSchema().finally(loadConfig);
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
                    <UiButton variant="primary" @click="accountWizardRef?.openAdd()">
                        <IconPlus :size="16" aria-hidden="true" />
                        新增账号
                    </UiButton>
                    <UiButton variant="secondary" @click="handleDownloadConfig">
                        <IconDownload :size="16" aria-hidden="true" />
                        下载当前配置
                    </UiButton>
                    <UiButton variant="secondary" @click="handleReload">
                        <IconRefresh :size="16" aria-hidden="true" />
                        重新读取
                    </UiButton>
                    <UiButton variant="primary" :disabled="saving" @click="handleSave">
                        <IconCheck :size="16" aria-hidden="true" />
                        {{ saving ? "正在应用…" : "保存并应用" }}
                    </UiButton>
                </div>
            </header>

            <UiCard>
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

                <ConfigAccountsTab
                    v-else-if="activeTab === 'accounts'"
                    :accounts="accounts"
                    :account-empty-text="accountEmptyText"
                    @edit="row => accountWizardRef?.openEdit(row)"
                    @remove="handleRemoveAccount" />
            </UiCard>
        </div>
    </div>

    <AccountWizard ref="accountWizardRef" :schema="schema" @saved="loadConfig" />
</template>
