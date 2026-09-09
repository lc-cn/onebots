<script setup lang="ts">
import { onUnmounted, reactive, watch } from "vue";
import { controlVerificationOutcome, type ControlClient } from "@onebots/core/control";
import ControlVerificationCode from "./ControlVerificationCode.vue";
import UiButton from "../ui/UiButton.vue";
import {
    VerificationController,
    verificationView,
    safeVerificationImage,
    safeVerificationUrl,
} from "./control-verification-state";
const props = defineProps<{ client: ControlClient; gatewayInstanceId?: string }>();
const view = reactive(verificationView());
const controller = new VerificationController(props.client, view, {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
});
void controller.initialize();
watch(
    () => props.gatewayInstanceId,
    id => controller.setGateway(id),
    { immediate: true },
);
onUnmounted(() => controller.dispose());
const labels = {
    running: "处理中，只查询回执",
    succeeded: "验证调用已完成（不代表账号已上线）",
    rejected: "请求被拒绝",
    unknown: "执行结果未知，可核对网关原回执，不可重新提交",
};
</script>

<template>
    <section class="border border-border rounded-panel p-6 bg-surface space-y-4">
        <h2 class="text-lg font-medium">账号登录验证</h2>
        <p class="text-sm text-fg-secondary">
            按平台提示完成验证。答案仅用于本次提交；浏览器只保存操作编号。不要清除记录来绕过未知结果。
        </p>
        <p v-if="view.error" role="alert" class="text-danger">{{ view.error }}</p>
        <UiButton :disabled="view.busy || !gatewayInstanceId" @click="controller.refresh()"
            >刷新验证请求</UiButton
        >
        <p v-if="!gatewayInstanceId" class="text-sm text-fg-secondary">
            网关不可用，仍可查询下方已有操作回执。
        </p>
        <p v-if="controller.uncertain" role="status" class="text-sm text-danger">
            有尚未确认的操作，已禁止新提交和短信请求。请查询原回执；未知结果不能自动解锁。
        </p>
        <p v-if="view.snapshot && !view.snapshot.challenges.length">当前没有待处理验证。</p>
        <article
            v-for="challenge in view.snapshot?.challenges ?? []"
            :key="challenge.id"
            class="border-t border-border pt-4 space-y-3">
            <h3 class="font-medium">
                {{ challenge.request.platform }} / {{ challenge.request.account_id }}
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
                <div v-else-if="block.type === 'input'">
                    <label :for="`${challenge.id}-${index}`" class="block text-sm mb-1">{{
                        block.placeholder || block.key
                    }}</label>
                    <input
                        :id="`${challenge.id}-${index}`"
                        v-model="view.answers[challenge.id][block.key]"
                        type="password"
                        autocomplete="off"
                        :maxlength="Math.min(block.maxLength ?? 16384, 16384)"
                        :disabled="view.busy || controller.uncertain"
                        class="w-full rounded-control border border-border bg-surface p-3" />
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
                        class="max-w-full max-h-80" />
                    <p v-else class="text-danger">
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
            <div class="flex flex-wrap gap-3">
                <UiButton
                    v-if="
                        challenge.request.confirmable ||
                        challenge.request.options?.blocks?.some(block => block.type === 'input')
                    "
                    :disabled="view.busy || !view.ready || controller.uncertain"
                    @click="controller.submit(challenge.id, 'submit')"
                    >{{ challenge.request.confirmLabel || "提交验证" }}</UiButton
                >
                <UiButton
                    v-if="challenge.request.requestSmsAvailable"
                    :disabled="view.busy || !view.ready || controller.uncertain"
                    @click="controller.submit(challenge.id, 'request-sms')"
                    >请求短信验证码</UiButton
                >
                <UiButton
                    v-for="action in challenge.request.actions ?? []"
                    :key="action.id"
                    :disabled="view.busy || !view.ready || controller.uncertain"
                    @click="controller.submit(challenge.id, 'submit', action.id)"
                    >{{ action.label }}</UiButton
                >
            </div>
        </article>
        <div v-if="view.ids.length" class="border-t border-border pt-4 space-y-3">
            <h3 class="font-medium">验证操作回执</h3>
            <p class="text-sm text-fg-secondary">
                核对只读取原网关结果，不会重新验证。仅原网关存活且有确定结果才能解锁；网关退出或结果缺失仍保留未知，暂不支持手工接受风险解锁。
            </p>
            <div v-for="id in [...view.ids].reverse()" :key="id" class="space-y-1">
                <code class="text-xs break-all">{{ id }}</code>
                <p class="text-sm">
                    {{
                        view.receipts[id]
                            ? labels[controlVerificationOutcome(view.receipts[id])]
                            : "尚未查询确认"
                    }}
                </p>
                <UiButton :disabled="view.busy" @click="controller.query(id)">查询原回执</UiButton>
                <UiButton
                    v-if="view.receipts[id]?.status === 'unknown' && !view.receipts[id]?.resolution"
                    :disabled="view.busy"
                    @click="controller.reconcile(id)"
                    >核对网关原回执</UiButton
                >
                <p v-if="view.receipts[id]?.resolution" class="text-xs text-fg-muted">
                    原回执为未知；{{ view.receipts[id].resolution?.confirmedAt }} 已核对网关结果。
                </p>
            </div>
        </div>
    </section>
</template>
