<script setup lang="ts">
import { computed, ref } from "vue";
import { IconX } from "@tabler/icons-vue";
import type { Workspace } from "../control-workspace.js";

const props = defineProps<{ active: Workspace }>();

const storageKey = "onebots.control.feature-intro.v2";
const hints: Partial<Record<Workspace, { title: string; body: string }>> = {
    accounts: {
        title: "先连接账号",
        body: "在账号卡片编辑平台身份和连接参数；协议出口在独立的“协议”页面添加。",
    },
    protocols: {
        title: "再开放协议出口",
        body: "为具体账号添加输出协议，复制对应连接地址给下游应用。",
    },
    extensions: {
        title: "按需要安装扩展",
        body: "选择平台和输出协议后确认安装。检查更新只会生成计划，不会自动升级。",
    },
    system: {
        title: "访问与通知在这里",
        body: "设备授权在“设备与访问”；Webhook、邮件和 Bark 在“通知”。",
    },
};

function readSeen(): Set<Workspace> {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
        return new Set(
            Array.isArray(value)
                ? value.filter(
                      (item): item is Workspace => typeof item === "string" && item in hints,
                  )
                : [],
        );
    } catch {
        return new Set();
    }
}

const seen = ref(readSeen());
const hint = computed(() => hints[props.active]);
const visible = computed(() => Boolean(hint.value && !seen.value.has(props.active)));

function dismiss(all = false) {
    const next = new Set(seen.value);
    if (all) Object.keys(hints).forEach(key => next.add(key as Workspace));
    else next.add(props.active);
    seen.value = next;
    try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
        // 私密浏览模式下仍在本次页面会话内记住已关闭的提示。
    }
}
</script>

<template>
    <aside v-if="visible && hint" class="feature-intro" aria-labelledby="feature-intro-title">
        <button
            type="button"
            class="feature-intro-close"
            aria-label="关闭本页提示"
            @click="dismiss()">
            <IconX :size="17" aria-hidden="true" />
        </button>
        <span class="feature-intro-eyebrow"
            >首次使用 ·
            {{
                active === "accounts"
                    ? "账号"
                    : active === "protocols"
                      ? "协议"
                      : active === "extensions"
                        ? "扩展"
                        : "系统"
            }}</span
        >
        <h2 id="feature-intro-title">{{ hint.title }}</h2>
        <p>{{ hint.body }}</p>
        <div class="feature-intro-actions">
            <button type="button" @click="dismiss(true)">不再显示提示</button>
            <button type="button" class="feature-intro-done" @click="dismiss()">知道了</button>
        </div>
    </aside>
</template>
