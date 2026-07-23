<script setup lang="ts">
import { ref, onMounted, reactive, computed, watch } from 'vue';
import {
    IconSettings,
    IconRefresh,
    IconCheck,
    IconPlus,
    IconDownload,
    IconUpload,
    IconTrash,
    IconEdit
} from '@tabler/icons-vue';
import { buildApiUrl } from '../config';
import { authFetch } from '../composables/useAuth';
import yaml from 'js-yaml';
import SchemaField from '../components/SchemaField.vue';
import UiButton from '../ui/UiButton.vue';
import UiCard from '../ui/UiCard.vue';
import UiTabs from '../ui/UiTabs.vue';
import UiCollapse from '../ui/UiCollapse.vue';
import UiCollapseItem from '../ui/UiCollapseItem.vue';
import UiDivider from '../ui/UiDivider.vue';
import UiField from '../ui/UiField.vue';
import UiInput from '../ui/UiInput.vue';
import UiTextarea from '../ui/UiTextarea.vue';
import UiSelect from '../ui/UiSelect.vue';
import UiSwitch from '../ui/UiSwitch.vue';
import UiModal from '../ui/UiModal.vue';
import UiEmpty from '../ui/UiEmpty.vue';
import UiAlert from '../ui/UiAlert.vue';
import UiSpinner from '../ui/UiSpinner.vue';
import { useToast } from '../ui/toast.js';
import { useConfirm } from '../ui/confirm.js';

type ValidationRule = {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    min?: number;
    max?: number;
    pattern?: RegExp;
    enum?: any[];
    default?: any;
    label?: string;
    description?: string;
    placeholder?: string;
};

type Schema = Record<string, ValidationRule | Schema>;
type SchemaBundle = {
    base?: Schema;
    general?: Schema;
    protocols?: Record<string, Schema>;
    adapters?: Record<string, Schema>;
};

type SchemaFieldDef = {
    path: string[];
    key: string;
    label: string;
    rule: ValidationRule;
    placeholder: string;
};

type SchemaGroup = {
    key: string;
    title: string;
    fields: SchemaFieldDef[];
};

const toast = useToast();
const { confirm } = useConfirm();

const tabs = [
    { key: 'schema', label: '表单' },
    { key: 'raw', label: '原始配置' },
    { key: 'static', label: '站点静态' },
    { key: 'accounts', label: '账号' }
];

const config = ref<string>('');
const activeTab = ref<string>('schema');
const schema = ref<SchemaBundle | null>(null);
const schemaGroups = ref<SchemaGroup[]>([]);
const activeGroups = ref<string[]>([]);
const formModel = reactive<Record<string, any>>({});

type AccountRow = {
    key: string;
    platform: string;
    account_id: string;
    config: Record<string, any>;
    preview: string;
};

const accounts = ref<AccountRow[]>([]);
const accountEmptyText = ref('暂无账号');
const accountDialogVisible = ref(false);
const accountDialogTitle = ref('新增账号');
const accountForm = ref({ platform: '', account_id: '' });
const accountOriginalConfig = ref<Record<string, any>>({});
const accountFormModel = reactive<Record<string, any>>({});
const accountProtocolGroups = ref<SchemaGroup[]>([]);
const accountAdapterFields = ref<SchemaFieldDef[]>([]);
const accountActiveProtocolGroups = ref<string[]>([]);
const accountProtocolEnabled = reactive<Record<string, boolean>>({});
const isAccountEdit = ref(false);

/** 站点根静态文件（public_static_dir） */
const staticFiles = ref<{ name: string }[]>([]);
const staticRootDisplay = ref('');
const staticError = ref('');
const staticLoading = ref(false);
const staticUploading = ref(false);
const staticFileInput = ref<HTMLInputElement | null>(null);

/** Hugging Face Space 典型域名，用于提示上传后会触发仓库备份 */
const staticHfHint =
    typeof window !== 'undefined' && /\.hf\.space$/i.test(window.location.hostname)
        ? '在 HF 上若已配置 HF_TOKEN / HF_REPO_ID，上传或删除后将自动把整包 data（含 static）推送到 Space 仓库，避免重启丢失'
        : '';

const publicBaseUrl = typeof window !== 'undefined' ? `${window.location.origin}/` : '/';

type StaticApiHfBackup = { attempted: boolean; success?: boolean; message?: string };

const notifyStaticHfBackup = (hf: StaticApiHfBackup | undefined, primaryOk: string) => {
    if (!hf?.attempted) {
        toast.success(primaryOk);
        return;
    }
    if (hf.success) {
        toast.success(
            `${primaryOk}，已同步备份至 Hugging Face 仓库（config_backup.yaml + data_backup.tar.gz）`
        );
    } else {
        toast.warning(
            `${primaryOk}，但 Hugging Face 备份失败：${hf.message || '未知错误'}，请检查 Secrets 或稍后重试`
        );
    }
};

const isRule = (rule: ValidationRule | Schema): rule is ValidationRule => {
    return (
        typeof rule === 'object' &&
        ('type' in rule || 'required' in rule || 'enum' in rule || 'default' in rule)
    );
};

const makeKey = (path: string[]) => path.join('::');

const getValueByPath = (data: Record<string, any>, path: string[]) => {
    return path.reduce((acc, key) => (acc ? acc[key] : undefined), data);
};

const setValueByPath = (data: Record<string, any>, path: string[], value: any) => {
    const keys = path;
    let current = data;
    keys.forEach((key, index) => {
        if (index === keys.length - 1) {
            current[key] = value;
            return;
        }
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    });
};

const buildSchemaFields = (schemaData: Schema, basePath: string[] = []): SchemaFieldDef[] => {
    const fields: SchemaFieldDef[] = [];
    Object.entries(schemaData).forEach(([key, rule]) => {
        const currentPath = [...basePath, key];
        if (isRule(rule)) {
            fields.push({
                path: currentPath,
                key: makeKey(currentPath),
                label: rule.label || currentPath.join('.'),
                rule,
                placeholder:
                    rule.placeholder ||
                    (rule.default !== undefined ? `默认：${String(rule.default)}` : '')
            });
        } else {
            fields.push(...buildSchemaFields(rule as Schema, currentPath));
        }
    });
    return fields;
};

const syncFormModel = (configObject: Record<string, any>) => {
    schemaGroups.value.forEach(group => {
        group.fields.forEach(field => {
            const currentValue = getValueByPath(configObject, field.path);
            if (field.rule.type === 'object' || field.rule.type === 'array') {
                const baseValue =
                    currentValue ?? field.rule.default ?? (field.rule.type === 'array' ? [] : {});
                formModel[field.key] = JSON.stringify(baseValue, null, 2);
                return;
            }
            formModel[field.key] =
                currentValue ?? field.rule.default ?? (field.rule.type === 'boolean' ? false : '');
        });
    });
};

const syncAccountFormModel = (configObject: Record<string, any>) => {
    accountProtocolGroups.value.forEach(group => {
        const enabled = Boolean(configObject[group.key]);
        accountProtocolEnabled[group.key] = enabled;
        group.fields.forEach(field => {
            const currentValue = getValueByPath(configObject, field.path);
            if (field.rule.type === 'object' || field.rule.type === 'array') {
                const baseValue =
                    currentValue ?? field.rule.default ?? (field.rule.type === 'array' ? [] : {});
                accountFormModel[field.key] = JSON.stringify(baseValue, null, 2);
                return;
            }
            accountFormModel[field.key] =
                currentValue ?? field.rule.default ?? (field.rule.type === 'boolean' ? false : '');
        });
    });

    accountAdapterFields.value.forEach(field => {
        const currentValue = getValueByPath(configObject, field.path);
        if (field.rule.type === 'object' || field.rule.type === 'array') {
            const baseValue =
                currentValue ?? field.rule.default ?? (field.rule.type === 'array' ? [] : {});
            accountFormModel[field.key] = JSON.stringify(baseValue, null, 2);
            return;
        }
        accountFormModel[field.key] =
            currentValue ?? field.rule.default ?? (field.rule.type === 'boolean' ? false : '');
    });
};

const normalizeSchema = (data: Schema | SchemaBundle): SchemaBundle => {
    if ('base' in data || 'general' in data || 'protocols' in data || 'adapters' in data) {
        return data as SchemaBundle;
    }
    return { base: data as Schema };
};

const buildGroups = (configObject: Record<string, any>) => {
    if (!schema.value) {
        schemaGroups.value = [];
        return;
    }

    const groups: SchemaGroup[] = [];
    const bundle = schema.value;

    if (bundle.base) {
        groups.push({
            key: 'base',
            title: '基础配置',
            fields: buildSchemaFields(bundle.base)
        });
    }

    if (bundle.general) {
        groups.push({
            key: 'general',
            title: '全局协议配置',
            fields: buildSchemaFields(bundle.general, ['general'])
        });
    }

    const baseKeys = new Set([
        'port',
        'path',
        'database',
        'timeout',
        'username',
        'password',
        'log_level',
        'general'
    ]);
    const accountKeys = Object.keys(configObject).filter(
        key => key.includes('.') && !baseKeys.has(key)
    );

    if (accountKeys.length && (bundle.protocols || bundle.adapters)) {
        accountKeys.forEach(accountKey => {
            const fields: SchemaFieldDef[] = [];
            if (bundle.protocols) {
                Object.entries(bundle.protocols).forEach(([protocolKey, protocolSchema]) => {
                    fields.push(...buildSchemaFields(protocolSchema, [accountKey, protocolKey]));
                });
            }
            if (bundle.adapters) {
                const platform = accountKey.split('.')[0];
                const adapterSchema = bundle.adapters[platform];
                if (adapterSchema) {
                    const adapterFields = buildSchemaFields(adapterSchema, [accountKey]).filter(
                        field => field.path.join('.') !== `${accountKey}.account_id`
                    );
                    fields.push(...adapterFields);
                }
            }
            if (fields.length) {
                groups.push({
                    key: `account:${accountKey}`,
                    title: `账号配置：${accountKey}`,
                    fields
                });
            }
        });
    }

    schemaGroups.value = groups;
    activeGroups.value = groups.map(group => group.key);
};

const adapterNames = computed(() => Object.keys(schema.value?.adapters || {}));

const platformOptions = computed(() =>
    adapterNames.value.map(name => ({ label: name, value: name }))
);

const buildAccountProtocolGroups = () => {
    if (!schema.value?.protocols) {
        accountProtocolGroups.value = [];
        return;
    }
    const groups: SchemaGroup[] = [];
    Object.entries(schema.value.protocols).forEach(([protocolKey, protocolSchema]) => {
        groups.push({
            key: protocolKey,
            title: protocolKey,
            fields: buildSchemaFields(protocolSchema, [protocolKey])
        });
        if (accountProtocolEnabled[protocolKey] === undefined) {
            accountProtocolEnabled[protocolKey] = false;
        }
    });
    accountProtocolGroups.value = groups;
    accountActiveProtocolGroups.value = groups.map(group => group.key);
};

const buildAccountAdapterFields = (platform: string) => {
    const adapterSchema = schema.value?.adapters?.[platform];
    if (!adapterSchema) {
        accountAdapterFields.value = [];
        return;
    }
    accountAdapterFields.value = buildSchemaFields(adapterSchema, []).filter(
        field => field.path.join('.') !== 'account_id'
    );
};

const loadAccounts = () => {
    const configObject = (yaml.load(config.value) || {}) as Record<string, any>;
    const baseKeys = new Set([
        'port',
        'path',
        'database',
        'timeout',
        'username',
        'password',
        'log_level',
        'general'
    ]);
    const rows: AccountRow[] = [];

    Object.entries(configObject).forEach(([key, value]) => {
        if (!key.includes('.') || baseKeys.has(key)) return;
        const [platform, ...rest] = key.split('.');
        const account_id = rest.join('.');
        rows.push({
            key,
            platform,
            account_id,
            config: value as Record<string, any>,
            preview: JSON.stringify(value, null, 2)
        });
    });

    accounts.value = rows;
    accountEmptyText.value = rows.length ? '' : '暂无账号';
};

const loadConfig = async () => {
    try {
        const response = await authFetch(buildApiUrl('/api/config'));
        if (response.ok) {
            config.value = await response.text();
            const configObject = (yaml.load(config.value) || {}) as Record<string, any>;
            buildGroups(configObject);
            loadAccounts();
            if (schemaGroups.value.length) {
                syncFormModel(configObject);
            }
        }
    } catch (error) {
        console.error('加载配置失败:', error);
        toast.error('加载配置失败');
    }
};

const loadSchema = async () => {
    try {
        const response = await authFetch(buildApiUrl('/api/config/schema'));
        if (response.ok) {
            const rawSchema = await response.json();
            schema.value = normalizeSchema(rawSchema);
            buildAccountProtocolGroups();
        }
    } catch (error) {
        console.error('加载配置 Schema 失败:', error);
    }
};

const handleReload = () => {
    toast.info('正在重载配置...');
    loadSchema();
    loadConfig();
};

const handleDownloadConfig = async () => {
    try {
        const response = await authFetch(buildApiUrl('/api/config'));
        if (!response.ok) throw new Error('获取配置失败');
        const text = await response.text();
        const blob = new Blob([text], { type: 'application/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `config.yaml`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('已下载 config.yaml');
    } catch (error) {
        toast.error((error as Error).message || '下载失败');
    }
};

const handleSave = async () => {
    try {
        if (activeTab.value === 'schema') {
            const configObject = (yaml.load(config.value) || {}) as Record<string, any>;
            for (const group of schemaGroups.value) {
                for (const field of group.fields) {
                    let value = formModel[field.key];
                    if (field.rule.type === 'object' || field.rule.type === 'array') {
                        try {
                            value = value
                                ? JSON.parse(value)
                                : field.rule.type === 'array'
                                  ? []
                                  : {};
                        } catch (error) {
                            toast.error(`字段 ${field.label} 不是有效 JSON`);
                            return;
                        }
                    }
                    setValueByPath(configObject, field.path, value);
                }
            }
            config.value = yaml.dump(configObject, { lineWidth: 120 });
        }
        const response = await authFetch(buildApiUrl('/api/config'), {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: config.value
        });
        if (response.ok) {
            const result = await response.json();
            toast.success(result.message || '配置已保存');
        } else {
            const result = await response.json();
            toast.error(result.message || '保存失败');
        }
    } catch (error) {
        console.error('保存配置失败:', error);
        toast.error('保存配置失败');
    }
};

const loadStaticFiles = async () => {
    staticLoading.value = true;
    staticError.value = '';
    try {
        const response = await authFetch(buildApiUrl('/api/public-static/files'));
        const data = (await response.json().catch(() => ({}))) as {
            success?: boolean;
            message?: string;
            files?: string[];
            root?: string;
        };
        if (!response.ok) {
            staticFiles.value = [];
            staticRootDisplay.value = '';
            staticError.value =
                data.message || '无法加载列表（请检查是否已配置 public_static_dir 并保存）';
            return;
        }
        staticFiles.value = (data.files || []).map(name => ({ name }));
        staticRootDisplay.value = data.root || '';
    } catch {
        staticFiles.value = [];
        staticRootDisplay.value = '';
        staticError.value = '加载静态文件列表失败';
    } finally {
        staticLoading.value = false;
    }
};

const triggerStaticUpload = () => {
    if (staticUploading.value) return;
    staticFileInput.value?.click();
};

const onStaticFileChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // 重置 input，允许连续选择同一文件再次触发 change
    input.value = '';
    if (!file) return;
    void submitStaticUpload(file);
};

/** 使用 authFetch 以便 401 时刷新 Token，与下载配置等行为一致 */
const submitStaticUpload = async (file: File) => {
    staticUploading.value = true;
    try {
        const fd = new FormData();
        fd.append('file', file, file.name);
        const res = await authFetch(buildApiUrl('/api/public-static/upload'), {
            method: 'POST',
            body: fd
        });
        const data = (await res.json().catch(() => ({}))) as {
            message?: string;
            hf_backup?: StaticApiHfBackup;
        };
        if (!res.ok) {
            toast.error(data.message || '上传失败');
            return;
        }
        notifyStaticHfBackup(data.hf_backup, data.message || '上传成功');
        await loadStaticFiles();
    } catch {
        toast.error('上传失败，请检查网络、登录状态或文件是否过大（≤2MB）');
    } finally {
        staticUploading.value = false;
    }
};

const handleDeleteStaticFile = async (name: string) => {
    const ok = await confirm({
        title: '删除静态文件',
        message: `确定删除「${name}」吗？`,
        confirmText: '删除',
        danger: true
    });
    if (!ok) return;
    const response = await authFetch(
        buildApiUrl(`/api/public-static/${encodeURIComponent(name)}`),
        { method: 'DELETE' }
    );
    const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        hf_backup?: StaticApiHfBackup;
    };
    if (response.ok) {
        notifyStaticHfBackup(result.hf_backup, result.message || '已删除');
        await loadStaticFiles();
    } else {
        toast.error(result.message || '删除失败');
    }
};

onMounted(() => {
    loadSchema().finally(loadConfig);
});

watch(activeTab, name => {
    if (name === 'static') void loadStaticFiles();
});

const openAddAccount = () => {
    accountDialogTitle.value = '新增账号';
    isAccountEdit.value = false;
    accountOriginalConfig.value = {};
    accountForm.value = { platform: '', account_id: '' };
    buildAccountAdapterFields('');
    syncAccountFormModel({});
    accountDialogVisible.value = true;
};

const openEditAccount = (row: AccountRow) => {
    accountDialogTitle.value = '编辑账号';
    isAccountEdit.value = true;
    accountOriginalConfig.value = JSON.parse(JSON.stringify(row.config || {}));
    accountForm.value = { platform: row.platform, account_id: row.account_id };
    buildAccountAdapterFields(row.platform);
    syncAccountFormModel(row.config || {});
    accountDialogVisible.value = true;
};

const handleSubmitAccount = async () => {
    if (!accountForm.value.platform || !accountForm.value.account_id) {
        toast.warning('请填写平台与账号ID');
        return;
    }

    const configObject = JSON.parse(JSON.stringify(accountOriginalConfig.value || {}));

    for (const group of accountProtocolGroups.value) {
        if (!accountProtocolEnabled[group.key]) {
            delete configObject[group.key];
            continue;
        }
        for (const field of group.fields) {
            let value = accountFormModel[field.key];
            if (field.rule.type === 'object' || field.rule.type === 'array') {
                try {
                    value = value ? JSON.parse(value) : field.rule.type === 'array' ? [] : {};
                } catch {
                    toast.error(`字段 ${field.label} 不是有效 JSON`);
                    return;
                }
            }
            setValueByPath(configObject, field.path, value);
        }
    }

    for (const field of accountAdapterFields.value) {
        let value = accountFormModel[field.key];
        if (field.rule.type === 'object' || field.rule.type === 'array') {
            try {
                value = value ? JSON.parse(value) : field.rule.type === 'array' ? [] : {};
            } catch {
                toast.error(`字段 ${field.label} 不是有效 JSON`);
                return;
            }
        }
        setValueByPath(configObject, field.path, value);
    }

    const payload = {
        ...configObject,
        platform: accountForm.value.platform,
        account_id: accountForm.value.account_id
    };

    const url = isAccountEdit.value ? '/api/edit' : '/api/add';
    const response = await authFetch(buildApiUrl(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        toast.success('保存成功');
        accountDialogVisible.value = false;
        await loadConfig();
    } else {
        const result = await response.json().catch(() => ({}));
        toast.error(result.message || '保存失败');
    }
};

const handleRemoveAccount = async (row: AccountRow) => {
    const ok = await confirm({
        title: '提示',
        message: `确认删除账号 ${row.platform}.${row.account_id} 吗？`,
        confirmText: '删除',
        danger: true
    });
    if (!ok) return;

    const url = buildApiUrl(
        `/api/remove?platform=${encodeURIComponent(row.platform)}&uin=${encodeURIComponent(row.account_id)}`
    );
    const response = await authFetch(url);
    if (response.ok) {
        toast.success('删除成功');
        await loadConfig();
    } else {
        const result = await response.json().catch(() => ({}));
        toast.error(result.message || '删除失败');
    }
};

watch(
    () => accountForm.value.platform,
    platform => {
        if (!platform) return;
        buildAccountAdapterFields(platform);
        syncAccountFormModel(accountOriginalConfig.value || {});
    }
);
</script>

<template>
    <div class="h-full overflow-y-auto">
        <div class="mx-auto max-w-[1400px] px-6 py-6">
            <header class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <h2 class="flex items-center gap-2 text-lg font-semibold text-fg">
                    <IconSettings :size="20" aria-hidden="true" />
                    配置管理
                </h2>
                <div class="flex flex-wrap items-center gap-2">
                    <UiButton variant="primary" @click="openAddAccount">
                        <IconPlus :size="16" aria-hidden="true" />
                        新增账号
                    </UiButton>
                    <UiButton variant="secondary" @click="handleDownloadConfig">
                        <IconDownload :size="16" aria-hidden="true" />
                        下载当前配置
                    </UiButton>
                    <UiButton variant="secondary" @click="handleReload">
                        <IconRefresh :size="16" aria-hidden="true" />
                        重载配置
                    </UiButton>
                    <UiButton variant="primary" @click="handleSave">
                        <IconCheck :size="16" aria-hidden="true" />
                        保存配置
                    </UiButton>
                </div>
            </header>

            <UiCard>
                <UiTabs v-model="activeTab" :tabs="tabs" />

                <!-- 表单 -->
                <div v-if="activeTab === 'schema'" class="pt-4">
                    <UiCollapse v-if="schemaGroups.length" v-model="activeGroups">
                        <UiCollapseItem
                            v-for="group in schemaGroups"
                            :key="group.key"
                            :name="group.key"
                            :title="group.title">
                            <div class="flex flex-col gap-4">
                                <SchemaField
                                    v-for="field in group.fields"
                                    :key="field.key"
                                    v-model="formModel[field.key]"
                                    :field="field" />
                            </div>
                        </UiCollapseItem>
                    </UiCollapse>
                    <UiEmpty v-else title="未获取到配置 Schema" />
                </div>

                <!-- 原始配置 -->
                <div v-else-if="activeTab === 'raw'" class="pt-4">
                    <UiTextarea v-model="config" mono :rows="24" placeholder="配置内容" />
                </div>

                <!-- 站点静态 -->
                <div v-else-if="activeTab === 'static'" class="flex flex-col gap-3 pt-4">
                    <UiAlert variant="info" title="可信域名等校验文件">
                        请先在「表单」→「基础配置」中设置 <strong>public_static_dir</strong>（如
                        <code>static</code>）并<strong>保存配置</strong>后，再上传文件。保存后公网访问地址示例：
                        <code>{{ publicBaseUrl }}你的文件名.txt</code>
                        <span v-if="staticHfHint">；{{ staticHfHint }}</span>
                    </UiAlert>
                    <UiAlert v-if="staticError" variant="warning">
                        {{ staticError }}
                    </UiAlert>
                    <div class="flex flex-wrap items-center gap-2">
                        <UiButton
                            variant="primary"
                            :loading="staticUploading"
                            @click="triggerStaticUpload">
                            <IconUpload :size="16" aria-hidden="true" />
                            上传文件
                        </UiButton>
                        <UiButton variant="secondary" :loading="staticLoading" @click="loadStaticFiles">
                            <IconRefresh :size="16" aria-hidden="true" />
                            刷新列表
                        </UiButton>
                        <input
                            ref="staticFileInput"
                            type="file"
                            class="hidden"
                            accept=".txt,.html,.json,text/plain"
                            @change="onStaticFileChange" />
                    </div>
                    <p v-if="staticRootDisplay" class="text-xs text-fg-tertiary">
                        目录：{{ staticRootDisplay }}
                    </p>
                    <div class="overflow-x-auto rounded-card border border-border">
                        <table v-if="!staticLoading && staticFiles.length" class="w-full text-sm">
                            <thead>
                                <tr class="border-b border-border text-left text-xs text-fg-tertiary">
                                    <th class="px-3 py-2 font-medium">文件名</th>
                                    <th class="px-3 py-2 font-medium">公网路径</th>
                                    <th class="w-28 px-3 py-2 font-medium">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="file in staticFiles"
                                    :key="file.name"
                                    class="border-b border-border transition-colors last:border-b-0 hover:bg-surface-raised">
                                    <td class="px-3 py-2 font-mono text-[13px] text-fg">
                                        {{ file.name }}
                                    </td>
                                    <td class="px-3 py-2">
                                        <code class="break-all text-xs text-fg-secondary">
                                            {{ publicBaseUrl }}{{ file.name }}
                                        </code>
                                    </td>
                                    <td class="px-3 py-2">
                                        <UiButton
                                            variant="ghost"
                                            size="sm"
                                            @click="handleDeleteStaticFile(file.name)">
                                            <IconTrash :size="14" aria-hidden="true" />
                                            删除
                                        </UiButton>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <div
                            v-if="staticLoading"
                            class="flex items-center justify-center gap-2 py-10 text-fg-tertiary">
                            <UiSpinner :size="20" />
                            <span class="text-sm">加载中...</span>
                        </div>
                        <UiEmpty v-else-if="!staticFiles.length" title="暂无文件" />
                    </div>
                </div>

                <!-- 账号 -->
                <div v-else-if="activeTab === 'accounts'" class="pt-4">
                    <div class="overflow-x-auto rounded-card border border-border">
                        <table v-if="accounts.length" class="w-full text-sm">
                            <thead>
                                <tr class="border-b border-border text-left text-xs text-fg-tertiary">
                                    <th class="w-40 px-3 py-2 font-medium">平台</th>
                                    <th class="w-48 px-3 py-2 font-medium">账号ID</th>
                                    <th class="px-3 py-2 font-medium">配置</th>
                                    <th class="w-44 px-3 py-2 font-medium">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in accounts"
                                    :key="row.key"
                                    class="border-b border-border transition-colors last:border-b-0 hover:bg-surface-raised">
                                    <td class="px-3 py-2 text-fg">{{ row.platform }}</td>
                                    <td class="px-3 py-2 font-mono text-[13px] text-fg">
                                        {{ row.account_id }}
                                    </td>
                                    <td class="px-3 py-2">
                                        <pre
                                            class="m-0 max-w-md truncate font-mono text-xs text-fg-secondary"
                                            >{{ row.preview }}</pre
                                        >
                                    </td>
                                    <td class="px-3 py-2">
                                        <div class="flex items-center gap-2">
                                            <UiButton
                                                variant="secondary"
                                                size="sm"
                                                @click="openEditAccount(row)">
                                                <IconEdit :size="14" aria-hidden="true" />
                                                编辑
                                            </UiButton>
                                            <UiButton
                                                variant="danger"
                                                size="sm"
                                                @click="handleRemoveAccount(row)">
                                                <IconTrash :size="14" aria-hidden="true" />
                                                删除
                                            </UiButton>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <UiEmpty v-else :title="accountEmptyText" />
                    </div>
                </div>
            </UiCard>
        </div>
    </div>

    <!-- 账号新增/编辑弹窗 -->
    <UiModal v-model="accountDialogVisible" :title="accountDialogTitle" width="720px">
        <div class="flex flex-col gap-4">
            <UiField label="平台" required>
                <UiSelect
                    v-model="accountForm.platform"
                    :options="platformOptions"
                    placeholder="选择平台" />
            </UiField>
            <UiField label="账号ID" required>
                <UiInput v-model="accountForm.account_id" placeholder="例如: my_bot" />
            </UiField>

            <UiDivider>协议配置</UiDivider>
            <UiCollapse v-model="accountActiveProtocolGroups">
                <UiCollapseItem
                    v-for="group in accountProtocolGroups"
                    :key="group.key"
                    :name="group.key">
                    <template #title>
                        <span class="flex items-center gap-2">
                            <UiSwitch
                                v-model="accountProtocolEnabled[group.key]"
                                @click.stop />
                            <span>{{ group.title }}</span>
                        </span>
                    </template>
                    <div class="flex flex-col gap-4">
                        <SchemaField
                            v-for="field in group.fields"
                            :key="field.key"
                            v-model="accountFormModel[field.key]"
                            :field="field"
                            :disabled="!accountProtocolEnabled[group.key]" />
                    </div>
                </UiCollapseItem>
            </UiCollapse>

            <UiDivider>平台配置</UiDivider>
            <div v-if="accountAdapterFields.length" class="flex flex-col gap-4">
                <SchemaField
                    v-for="field in accountAdapterFields"
                    :key="field.key"
                    v-model="accountFormModel[field.key]"
                    :field="field" />
            </div>
            <UiEmpty v-else title="暂无平台 Schema" />
        </div>

        <template #footer>
            <UiButton variant="secondary" @click="accountDialogVisible = false">取消</UiButton>
            <UiButton variant="primary" @click="handleSubmitAccount">保存</UiButton>
        </template>
    </UiModal>
</template>
