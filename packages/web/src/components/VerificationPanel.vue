<template>
    <UiDrawer v-model="visible" title="登录验证" placement="bottom">
        <div class="space-y-3 overflow-y-auto p-4">
            <UiCard
                v-for="(req, index) in pending"
                :key="verificationCardKey(req, index)">
                <template #header>
                    <div class="flex w-full items-center justify-between gap-2">
                        <span class="font-medium"
                            >{{ req.platform }} / {{ req.account_id }}</span
                        >
                        <UiButton variant="ghost" size="sm" @click="onReject(req)">
                            <IconX :size="14" aria-hidden="true" />
                            关闭
                        </UiButton>
                    </div>
                </template>

                <p class="mb-3 text-sm text-fg-secondary">{{ req.hint ?? '需要完成验证' }}</p>
                <template v-if="req.options?.blocks?.length">
                    <template v-for="(block, i) in req.options.blocks" :key="i">
                        <img
                            v-if="block.type === 'image'"
                            :src="`data:image/png;base64,${block.base64}`"
                            :alt="block.alt ?? ''"
                            class="my-2 block h-auto max-w-[220px] rounded" />
                        <img
                            v-else-if="block.type === 'image_url'"
                            :src="block.url"
                            :alt="block.alt ?? ''"
                            class="my-2 block h-auto max-w-[220px] rounded"
                            referrerpolicy="no-referrer" />
                        <QrImage
                            v-else-if="block.type === 'qrcode'"
                            :content="block.content"
                            :alt="block.alt"
                            class="my-2" />
                        <a
                            v-else-if="block.type === 'link'"
                            :href="block.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="mb-2 block break-all text-accent hover:underline">
                            {{ block.label ?? block.url }}
                        </a>
                        <p v-else-if="block.type === 'text'" class="mt-2 text-sm text-fg-secondary">
                            {{ block.content }}
                        </p>
                        <UiInput
                            v-else-if="block.type === 'input'"
                            v-model="inputValues[inputKey(req, block.key)]"
                            :type="block.secret ? 'password' : 'text'"
                            :placeholder="block.placeholder"
                            :maxlength="block.maxLength"
                            clearable
                            class="mt-3 mb-2 block max-w-[320px]" />
                    </template>
                </template>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                    <UiButton
                        v-if="req.requestSmsAvailable && requestSms"
                        variant="secondary"
                        :loading="requestSmsLoading[reqKey(req)]"
                        @click="handleRequestSms(req)">
                        发送验证码
                    </UiButton>
                    <UiButton
                        v-if="hasInputBlocks(req)"
                        variant="primary"
                        :loading="submitting[reqKey(req)]"
                        @click="handleApprove(req)">
                        提交
                    </UiButton>
                    <UiButton
                        v-if="req.confirmable"
                        variant="primary"
                        :loading="submitting[reqKey(req)]"
                        @click="handleApprove(req)">
                        {{ req.confirmLabel || '已完成，继续登录' }}
                    </UiButton>
                    <UiButton
                        v-for="action in req.actions ?? []"
                        :key="action.id"
                        :variant="action.variant === 'primary' ? 'primary' : 'secondary'"
                        :loading="actionLoading[actionKey(req, action.id)]"
                        @click="handleAction(req, action.id)">
                        {{ action.label }}
                    </UiButton>
                    <UiButton variant="ghost" @click="onReject(req)">关闭</UiButton>
                </div>
            </UiCard>
            <UiEmpty v-if="pending.length === 0" title="暂无待处理验证" />
        </div>
    </UiDrawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { IconX } from '@tabler/icons-vue';
import UiDrawer from '../ui/UiDrawer.vue';
import UiCard from '../ui/UiCard.vue';
import UiButton from '../ui/UiButton.vue';
import UiInput from '../ui/UiInput.vue';
import UiEmpty from '../ui/UiEmpty.vue';
import QrImage from './QrImage.vue';
import { useToast } from '../ui/toast';
import type { VerificationRequest, VerificationBlock } from '../types';

const props = defineProps<{
    pending: VerificationRequest[];
    /** 用户确认/提交时调用，data 为 options 中 input 块按 key 收集的值；返回 success 供面板提示 */
    onApprove: (
        req: VerificationRequest,
        data: Record<string, string>
    ) => Promise<{ success: boolean; message?: string }>;
    /** 用户关闭/拒绝时调用 */
    onReject: (req: VerificationRequest) => void;
    /** 请求发送短信验证码（当 request.requestSmsAvailable 时展示「发送验证码」按钮） */
    requestSms?: (
        platform: string,
        account_id: string
    ) => Promise<{ success: boolean; message?: string }>;
    shouldOpenDrawer?: boolean;
    resetOpenDrawer?: () => void;
}>();

const toast = useToast();
const visible = ref(false);
const inputValues = ref<Record<string, string>>({});
const submitting = ref<Record<string, boolean>>({});
const requestSmsLoading = ref<Record<string, boolean>>({});
const actionLoading = ref<Record<string, boolean>>({});

watch(
    () => props.shouldOpenDrawer,
    v => {
        if (v) {
            visible.value = true;
            props.resetOpenDrawer?.();
        }
    }
);

watch(
    () => props.pending.length,
    n => {
        if (n === 0) visible.value = false;
    },
    { immediate: true }
);

const reqKey = (req: VerificationRequest) => `${req.platform}:${req.account_id}:${req.type}`;
const actionKey = (req: VerificationRequest, actionId: string) => `${reqKey(req)}:${actionId}`;
const inputKey = (req: VerificationRequest, key: string) => `${reqKey(req)}:${key}`;

/** 二维码刷新等场景下让卡片 remount，避免仍显示旧图 */
function verificationCardKey(req: VerificationRequest, index: number): string {
    const qr =
        typeof req.data?.qrcode === 'string'
            ? req.data.qrcode
            : req.options?.blocks?.find(b => b.type === 'qrcode' || b.type === 'image');
    const stamp =
        typeof qr === 'string'
            ? qr.slice(0, 24)
            : qr && typeof qr === 'object' && 'content' in qr
              ? String((qr as { content?: string }).content ?? '').slice(0, 24)
              : qr && typeof qr === 'object' && 'base64' in qr
                ? String((qr as { base64?: string }).base64 ?? '').slice(0, 24)
                : req.hint;
    return `${req.platform}-${req.account_id}-${req.type}-${stamp}-${index}`;
}

function hasInputBlocks(req: VerificationRequest): boolean {
    return (
        req.options?.blocks?.some(
            (b): b is VerificationBlock & { type: 'input' } => b.type === 'input'
        ) ?? false
    );
}

function collectInputData(req: VerificationRequest): Record<string, string> {
    const data: Record<string, string> = {};
    req.options?.blocks?.forEach(block => {
        if (block.type === 'input') {
            const v = inputValues.value[inputKey(req, block.key)]?.trim();
            if (v !== undefined) data[block.key] = v;
        }
    });
    return data;
}

async function handleRequestSms(req: VerificationRequest) {
    if (!props.requestSms) return;
    const key = reqKey(req);
    requestSmsLoading.value[key] = true;
    try {
        const result = await props.requestSms(req.platform, req.account_id);
        if (result?.success) toast.success('验证码已发送，请查收短信');
        else toast.error(result?.message ?? '发送失败');
    } catch (error) {
        toast.error((error as Error)?.message ?? '发送失败');
    } finally {
        requestSmsLoading.value[key] = false;
    }
}

async function handleAction(req: VerificationRequest, actionId: string) {
    const key = actionKey(req, actionId);
    actionLoading.value[key] = true;
    try {
        const result = await props.onApprove(req, { action: actionId });
        if (result?.success) toast.success(actionId === 'relogin' ? '已触发重新登录' : '已提交，请等待结果');
        else toast.error(result?.message ?? '操作失败');
    } catch (error) {
        toast.error((error as Error)?.message ?? '操作失败');
    } finally {
        actionLoading.value[key] = false;
    }
}

async function handleApprove(req: VerificationRequest) {
    const data = collectInputData(req);
    const keys =
        req.options?.blocks
            ?.filter(b => b.type === 'input')
            .map(b => (b as { key: string }).key) ?? [];
    // 无输入块但可确认（如扫码/身份验证后继续登录）：直接提交空 data
    const canSubmitEmpty = keys.length === 0 && req.confirmable === true;
    if (canSubmitEmpty || (keys.length > 0 && keys.every(k => data[k]))) {
        submitting.value[reqKey(req)] = true;
        try {
            const result = await props.onApprove(req, data);
            if (result?.success) toast.success('已提交，请等待结果');
            else toast.error(result?.message ?? '提交失败');
        } catch (error) {
            toast.error((error as Error)?.message ?? '提交失败');
        } finally {
            submitting.value[reqKey(req)] = false;
        }
    } else {
        toast.warning('请填写完整后再提交');
    }
}
</script>
