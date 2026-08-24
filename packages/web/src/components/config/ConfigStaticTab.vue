<script setup lang="ts">
import { ref } from 'vue';
import { IconRefresh, IconUpload, IconTrash } from '@tabler/icons-vue';
import { buildApiUrl } from '../../config';
import { authFetch } from '../../composables/useAuth';
import UiButton from '../../ui/UiButton.vue';
import UiAlert from '../../ui/UiAlert.vue';
import UiEmpty from '../../ui/UiEmpty.vue';
import UiSpinner from '../../ui/UiSpinner.vue';
import { useToast } from '../../ui/toast.js';
import { useConfirm } from '../../ui/confirm.js';
import type { StaticApiHfBackup } from './types';

const toast = useToast();
const { confirm } = useConfirm();

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

/** 供父组件在切换到此 Tab 时调用 */
const refresh = () => {
    void loadStaticFiles();
};

defineExpose({ refresh });
</script>

<template>
    <div class="flex flex-col gap-3 pt-4">
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
</template>
