<script setup lang="ts">
import { onUnmounted, reactive, watch } from "vue";
import { controlVerificationOutcome, type ControlClient } from "@onebots/core/control";
import ControlVerificationCode from "./ControlVerificationCode.vue";
import { IconCircleCheck, IconCopy, IconFingerprint } from "@tabler/icons-vue";
import UiButton from "../ui/UiButton.vue";
import {
    copyDeviceJson,
    formatDeviceJson,
    ICQQ_DEVICE_HELPER_SCRIPT,
} from "./icqq-device-verification.js";
import type { ControlMutationBlock } from "../control-product-state.js";
import {
    VerificationController,
    verificationView,
    safeVerificationImage,
    safeVerificationUrl,
} from "./control-verification-state";
const props = defineProps<{
    client: ControlClient;
    gatewayInstanceId?: string;
    active: boolean;
    mutationBlock?: ControlMutationBlock;
}>();
const view = reactive(verificationView());
const abandoned = reactive<Record<string, boolean>>({});
const accepted = reactive<Record<string, boolean>>({});
const copyStatus = reactive<Record<string, string>>({});
async function copyJson(key: string, content: Record<string, unknown>): Promise<void> {
    try {
        await copyDeviceJson(content);
        copyStatus[key] = "JSON 已复制";
    } catch {
        copyStatus[key] = "复制失败，请手动选择 JSON 内容";
    }
}
async function copyHelper(key: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(ICQQ_DEVICE_HELPER_SCRIPT);
        copyStatus[key] = "辅助脚本已复制";
    } catch {
        copyStatus[key] = "复制失败，请手动选择脚本内容";
    }
}
const controller = new VerificationController(props.client, view, {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
});
watch(
    [() => props.active, () => props.gatewayInstanceId],
    async ([active, id]) => {
        controller.setGateway(id);
        if (!active) return;
        await controller.initialize();
        await controller.refresh();
    },
    { immediate: true },
);
onUnmounted(() => controller.dispose());
const labels = {
    running: "处理中，只查询回执",
    succeeded: "验证调用已完成（不代表账号已上线）",
    rejected: "请求被拒绝",
    unknown: "执行结果未知，可核对网关原回执，不可重新提交",
    acknowledged: "已接受未知结果，仅解除阻塞，不代表成功",
};
</script>

<template>
    <section class="verification-panel todo-panel space-y-4" aria-labelledby="verification-title">
        <header class="diagnostic-panel-header">
            <div>
                <p class="diagnostic-panel-kicker">账号待办</p>
                <h2 id="verification-title" class="text-lg font-medium">
                    <IconFingerprint :size="22" aria-hidden="true" />{{
                        view.snapshot?.challenges.length
                            ? `${view.snapshot.challenges.length} 项需要你处理`
                            : "账号验证"
                    }}
                </h2>
            </div>
        </header>
        <p v-if="mutationBlock" role="alert" class="text-sm text-danger">
            {{ mutationBlock.title }}，验证请求保持只读；仍可刷新挑战和查询既有回执。
        </p>
        <p v-if="view.error" role="alert" class="text-danger">{{ view.error }}</p>
        <div class="diagnostic-toolbar">
            <UiButton :disabled="view.busy || !gatewayInstanceId" @click="controller.refresh()">{{
                view.busy ? "刷新中…" : "刷新验证请求"
            }}</UiButton>
        </div>
        <p v-if="!gatewayInstanceId" class="text-sm text-fg-secondary">
            网关不可用，仍可查询下方已有操作回执。
        </p>
        <p v-if="controller.uncertain" role="status" class="text-sm text-danger">
            有尚未确认的操作，已禁止新提交和短信请求。请查询原回执；未知结果不能自动解锁。
        </p>
        <p
            v-if="view.snapshot && !view.snapshot.challenges.length"
            role="status"
            class="verification-empty">
            <IconCircleCheck :size="22" aria-hidden="true" />
            当前没有待处理验证。
        </p>
        <article
            v-for="challenge in view.snapshot?.challenges ?? []"
            :key="challenge.id"
            class="todo-challenge space-y-3">
            <h3 class="font-medium">
                {{ challenge.request.platform }} · {{ challenge.request.account_id }}
            </h3>
            <p class="whitespace-pre-wrap break-words">{{ challenge.request.hint }}</p>
            <p class="text-xs text-fg-muted">
                有效期至 {{ new Date(challenge.expiresAt).toLocaleString() }}；过期后请刷新。
            </p>
            <template
                v-for="(block, index) in challenge.request.options?.blocks ?? []"
                :key="index">
                <p v-if="block.type === 'text'" class="whitespace-pre-wrap break-words">
                    {{ block.content }}
                </p>
                <div v-else-if="block.type === 'json'" class="space-y-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <strong class="text-sm">{{ block.label || "JSON 数据" }}</strong>
                        <UiButton
                            size="sm"
                            variant="secondary"
                            :aria-label="`复制${block.label || 'JSON 数据'}`"
                            @click="copyJson(`${challenge.id}-${index}`, block.content)">
                            <IconCopy :size="14" aria-hidden="true" />复制 JSON
                        </UiButton>
                    </div>
                    <pre
                        class="max-h-60 overflow-auto rounded-control border border-border bg-surface p-3 text-xs font-mono select-text"
                        >{{ formatDeviceJson(block.content) }}</pre
                    >
                    <p v-if="copyStatus[`${challenge.id}-${index}`]" role="status" class="text-xs">
                        {{ copyStatus[`${challenge.id}-${index}`] }}
                    </p>
                    <details
                        v-if="
                            challenge.request.platform === 'icqq' &&
                            challenge.request.type === 'auth'
                        "
                        class="rounded-control border border-border p-3 text-sm">
                        <summary class="cursor-pointer">需要在 QQ 验证页填写设备信息？</summary>
                        <ol class="mt-3 list-decimal space-y-1 pl-5 text-fg-secondary">
                            <li>先复制上方设备 JSON，再点击验证链接并进入发送验证码页面。</li>
                            <li>打开该页面的开发者工具，在 Console 中粘贴辅助脚本并回车。</li>
                            <li>在弹出的输入框粘贴设备 JSON，成功后继续页面验证。</li>
                        </ol>
                        <UiButton
                            size="sm"
                            class="mt-3"
                            :aria-label="'复制 ICQQ 设备验证辅助脚本'"
                            @click="copyHelper(`${challenge.id}-${index}-script`)">
                            <IconCopy :size="14" aria-hidden="true" />复制辅助脚本
                        </UiButton>
                        <p
                            v-if="copyStatus[`${challenge.id}-${index}-script`]"
                            role="status"
                            class="mt-2 text-xs">
                            {{ copyStatus[`${challenge.id}-${index}-script`] }}
                        </p>
                        <pre class="mt-3 max-h-40 overflow-auto text-xs font-mono select-text">{{
                            ICQQ_DEVICE_HELPER_SCRIPT
                        }}</pre>
                    </details>
                </div>
                <div v-else-if="block.type === 'input'">
                    <label :for="`${challenge.id}-${index}`" class="block text-sm mb-1">{{
                        block.placeholder || block.key
                    }}</label>
                    <input
                        :id="`${challenge.id}-${index}`"
                        v-model="view.answers[challenge.id][block.key]"
                        type="password"
                        :name="`verification-${challenge.id}-${block.key}`"
                        autocomplete="one-time-code"
                        spellcheck="false"
                        autocapitalize="none"
                        :maxlength="Math.min(block.maxLength ?? 16384, 16384)"
                        :disabled="view.busy || controller.uncertain || !!mutationBlock"
                        class="w-full rounded-control border border-border bg-surface p-3 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--ring)]" />
                </div>
                <template v-else-if="block.type === 'link' || block.type === 'image_url'">
                    <a
                        v-if="safeVerificationUrl(block.url)"
                        :href="safeVerificationUrl(block.url)"
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerpolicy="no-referrer"
                        class="underline break-all"
                        >{{
                            block.type === "link"
                                ? block.label || "打开验证链接"
                                : block.alt || "手动查看验证图片"
                        }}</a
                    >
                    <p v-else class="text-danger">已阻止不安全的验证链接。</p>
                </template>
                <template v-else-if="block.type === 'image'">
                    <img
                        v-if="safeVerificationImage(block.base64)"
                        :src="safeVerificationImage(block.base64)"
                        :alt="block.alt || '验证图片'"
                        width="320"
                        height="320"
                        class="h-auto max-h-80 max-w-full object-contain" />
                    <p v-else role="alert" class="text-danger">
                        图片格式不受支持，请使用平台提供的其他验证方式。
                    </p>
                </template>
                <div v-else-if="block.type === 'qrcode'" class="space-y-2">
                    <ControlVerificationCode :content="block.content" :alt="block.alt" />
                    <p class="text-sm">
                        {{ block.alt || "二维码内容" }}：仅在可信平台应用中使用下方内容。
                    </p>
                    <pre class="whitespace-pre-wrap break-all text-xs">{{ block.content }}</pre>
                    <a
                        v-if="safeVerificationUrl(block.content)"
                        :href="safeVerificationUrl(block.content)"
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerpolicy="no-referrer"
                        class="underline"
                        >手动打开验证链接</a
                    >
                </div>
            </template>
            <div class="verification-actions flex flex-wrap gap-3">
                <UiButton
                    v-if="
                        challenge.request.confirmable ||
                        challenge.request.options?.blocks?.some(block => block.type === 'input')
                    "
                    variant="primary"
                    :disabled="view.busy || !view.ready || controller.uncertain || !!mutationBlock"
                    @click="controller.submit(challenge.id, 'submit')"
                    >{{ challenge.request.confirmLabel || "提交验证" }}</UiButton
                >
                <UiButton
                    v-if="challenge.request.requestSmsAvailable"
                    :disabled="view.busy || !view.ready || controller.uncertain || !!mutationBlock"
                    @click="controller.submit(challenge.id, 'request-sms')"
                    >请求短信验证码</UiButton
                >
                <UiButton
                    v-for="action in challenge.request.actions ?? []"
                    :key="action.id"
                    :disabled="view.busy || !view.ready || controller.uncertain || !!mutationBlock"
                    @click="controller.submit(challenge.id, 'submit', action.id)"
                    >{{ action.label }}</UiButton
                >
            </div>
        </article>
        <details
            v-if="view.ids.length"
            :open="controller.uncertain"
            class="verification-receipts space-y-3 border-t border-border pt-4"
            aria-live="polite">
            <summary class="font-medium">查看验证操作记录（{{ view.ids.length }}）</summary>
            <p class="text-sm text-fg-secondary">
                核对只读取原网关结果，不会重新验证。仅原网关存活且有确定结果才能解锁；网关退出或结果缺失仍保留未知。停止网关后可明确接受未知风险，只解除阻塞，不代表成功。
            </p>
            <div
                v-for="id in [...view.ids].reverse()"
                :key="id"
                class="verification-receipt space-y-2 rounded-card border border-border p-3">
                <code class="text-xs break-all">{{ id }}</code>
                <p class="text-sm">
                    {{
                        view.receipts[id]
                            ? labels[controlVerificationOutcome(view.receipts[id])]
                            : view.abandonments[id]
                              ? "编号已封存，迟到请求永久拒绝"
                              : "尚未查询确认"
                    }}
                </p>
                <UiButton :disabled="view.busy" @click="controller.query(id)">查询原回执</UiButton>
                <UiButton
                    v-if="
                        view.receipts[id]?.status === 'unknown' &&
                        !view.receipts[id]?.resolution &&
                        !view.receipts[id]?.acknowledgement
                    "
                    :disabled="view.busy || !!mutationBlock"
                    @click="controller.reconcile(id)"
                    >核对网关原回执</UiButton
                >
                <div
                    v-if="
                        view.receipts[id]?.status === 'unknown' &&
                        !view.receipts[id]?.resolution &&
                        !view.receipts[id]?.acknowledgement
                    "
                    class="space-y-2">
                    <p class="text-sm text-danger">
                        短信或登录可能已执行，接受结果不会撤销。请先停止网关；这里只解锁，不自动停止、发短信或重新提交。
                    </p>
                    <label class="flex min-h-11 items-start gap-2 text-sm">
                        <input
                            v-model="accepted[id]"
                            type="checkbox"
                            :disabled="view.busy || !!gatewayInstanceId || !!mutationBlock" />
                        我理解并接受未知结果风险
                    </label>
                    <UiButton
                        :disabled="
                            view.busy || !!gatewayInstanceId || !accepted[id] || !!mutationBlock
                        "
                        @click="
                            controller.acknowledge(id, accepted[id]);
                            accepted[id] = false;
                        "
                        >停止网关后接受未知结果</UiButton
                    >
                </div>
                <div v-if="!view.receipts[id] && !view.abandonments[id]" class="space-y-2">
                    <p class="text-sm text-danger">
                        查询失败不代表未执行。请先停止网关；服务端只有确认原操作未受理后才允许封存，迟到请求将永久拒绝。不表示平台从未发生过动作，不会重提或删除历史编号。
                    </p>
                    <label class="flex min-h-11 items-start gap-2 text-sm">
                        <input
                            v-model="abandoned[id]"
                            type="checkbox"
                            :disabled="view.busy || !!gatewayInstanceId || !!mutationBlock" />
                        我理解并确认永久封存此编号
                    </label>
                    <UiButton
                        :disabled="
                            view.busy || !!gatewayInstanceId || !abandoned[id] || !!mutationBlock
                        "
                        @click="
                            controller.abandon(id, abandoned[id]);
                            abandoned[id] = false;
                        ">
                        停止网关后封存未受理编号
                    </UiButton>
                </div>
                <p v-if="view.abandonments[id]" class="text-xs text-fg-muted">
                    {{ view.abandonments[id].abandonedAt }} 已封存；不表示平台从未发生过动作。
                </p>
                <p v-if="view.receipts[id]?.acknowledgement" class="text-xs text-fg-muted">
                    原结果仍未知；{{ view.receipts[id].acknowledgement?.acceptedAt }}
                    已明确接受风险。
                </p>
                <p v-if="view.receipts[id]?.resolution" class="text-xs text-fg-muted">
                    原回执为未知；{{ view.receipts[id].resolution?.confirmedAt }} 已核对网关结果。
                </p>
            </div>
        </details>
    </section>
</template>
