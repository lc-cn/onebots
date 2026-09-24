<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import type { ControlConfigurationSnapshot, ControlStatus } from "@onebots/core/control";
import {
    IconAlertTriangle,
    IconArrowRight,
    IconCheck,
    IconCopy,
    IconPlugConnected,
    IconSettings,
} from "@tabler/icons-vue";
import UiButton from "../ui/UiButton.vue";
import { buildControlConnectionGuides, normalizeConnectionOrigin } from "./control-connections.js";

const props = defineProps<{
    configuration?: ControlConfigurationSnapshot;
    status?: ControlStatus;
}>();
const emit = defineEmits<{ select: [workspace: "configuration" | "extensions"] }>();
const connectionOrigin = ref(window.location.origin);
const copied = ref("");
const copyError = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
const normalizedOrigin = computed(() => normalizeConnectionOrigin(connectionOrigin.value));
const guides = computed(() =>
    buildControlConnectionGuides(props.configuration, connectionOrigin.value),
);
const accountStatus = computed(
    () =>
        new Map(
            (props.status?.accounts?.items ?? []).map(item => [
                `${item.platform}:${item.accountId}`,
                item.status,
            ]),
        ),
);
const localOnly = computed(() => {
    if (!normalizedOrigin.value) return false;
    const host = new URL(normalizedOrigin.value).hostname;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
});

const statusLabel = (platform: string, accountId: string) => {
    const status = accountStatus.value.get(`${platform}:${accountId}`);
    return status
        ? { online: "账号在线", offline: "账号离线", pending: "账号连接中" }[status]
        : "状态未知";
};

async function copyEndpoint(id: string, value: string) {
    copyError.value = "";
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        const accepted = document.execCommand("copy");
        textarea.remove();
        if (!accepted) {
            copyError.value = "浏览器未允许复制，请选中地址后手动复制。";
            return;
        }
    }
    copied.value = id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
        if (copied.value === id) copied.value = "";
    }, 1800);
}

onUnmounted(() => clearTimeout(copiedTimer));
</script>

<template>
    <section class="connection-panel" aria-labelledby="connection-panel-title">
        <header class="connection-heading">
            <div>
                <p class="diagnostic-panel-kicker">配置完成后的下一步</p>
                <h2 id="connection-panel-title">
                    <IconPlugConnected :size="22" aria-hidden="true" />连接下游应用
                </h2>
                <p>
                    平台账号负责接收消息，协议出口负责让机器人框架调用
                    API、订阅事件。复制下面的地址，粘贴到下游应用对应的协议配置中。
                </p>
            </div>
        </header>

        <ol class="connection-flow" aria-label="OneBots 接入流程">
            <li><span>1</span><strong>平台账号</strong><small>消息进入 OneBots</small></li>
            <li aria-hidden="true"><IconArrowRight :size="18" /></li>
            <li><span>2</span><strong>协议出口</strong><small>转换 API 与事件</small></li>
            <li aria-hidden="true"><IconArrowRight :size="18" /></li>
            <li><span>3</span><strong>下游应用</strong><small>框架、插件或 AI 客户端</small></li>
        </ol>

        <label class="connection-origin">
            <span>
                <strong>下游访问 OneBots 的主机地址</strong>
                <small>地址只用于生成连接指引，不会修改服务配置。</small>
            </span>
            <input
                v-model.trim="connectionOrigin"
                type="url"
                inputmode="url"
                autocomplete="url"
                spellcheck="false"
                placeholder="https://bot.example.com" />
        </label>
        <p v-if="!normalizedOrigin" class="connection-warning" role="alert">
            <IconAlertTriangle :size="17" />请输入以 http:// 或 https://
            开头、且不含账号密码的地址。
        </p>
        <p v-else-if="localOnly" class="connection-note">
            当前是本机地址。下游如果运行在另一台机器，请改成它能够访问的服务器域名或 IP；不要复制
            localhost。
        </p>
        <p v-if="copyError" class="connection-warning" role="alert">{{ copyError }}</p>

        <div v-if="!configuration" class="connection-empty" role="status">
            <strong>正在读取账号与协议配置</strong>
            <p>管理服务返回配置后，这里会自动生成连接地址。</p>
        </div>
        <div v-else-if="!guides.length && normalizedOrigin" class="connection-empty">
            <IconSettings :size="28" aria-hidden="true" />
            <strong>还没有可以连接的协议出口</strong>
            <p>先为平台账号添加 OneBot、Satori 或 Milky；AI 客户端可使用 MCP 接入。</p>
            <div class="connection-empty-actions">
                <UiButton variant="primary" @click="emit('select', 'configuration')"
                    >配置账号与协议</UiButton
                >
                <UiButton @click="emit('select', 'extensions')">安装协议扩展</UiButton>
            </div>
        </div>

        <div v-else class="connection-list">
            <article v-for="guide in guides" :key="guide.id" class="connection-card">
                <header>
                    <div>
                        <p>{{ guide.category === "ai" ? "AI 接入" : "协议出口" }}</p>
                        <h3>{{ guide.protocolLabel }}</h3>
                        <span>{{ guide.platform }} / {{ guide.accountId }}</span>
                    </div>
                    <em
                        :class="
                            accountStatus.get(`${guide.platform}:${guide.accountId}`) ?? 'unknown'
                        "
                        >{{ statusLabel(guide.platform, guide.accountId) }}</em
                    >
                </header>

                <ol class="connection-steps">
                    <li v-for="(instruction, index) in guide.instructions" :key="instruction">
                        <span>{{ index + 1 }}</span
                        >{{ instruction }}
                    </li>
                </ol>

                <div v-if="guide.endpoints.length" class="endpoint-list">
                    <div
                        v-for="endpoint in guide.endpoints"
                        :key="endpoint.id"
                        class="endpoint-row">
                        <div class="endpoint-copy">
                            <span>{{ endpoint.label }}</span>
                            <code>{{ endpoint.url }}</code>
                            <small>{{ endpoint.purpose }}</small>
                        </div>
                        <button
                            type="button"
                            class="copy-endpoint"
                            :aria-label="`复制${endpoint.label}`"
                            @click="copyEndpoint(`${guide.id}:${endpoint.id}`, endpoint.url)">
                            <IconCheck
                                v-if="copied === `${guide.id}:${endpoint.id}`"
                                :size="17"
                                aria-hidden="true" />
                            <IconCopy v-else :size="17" aria-hidden="true" />
                            {{ copied === `${guide.id}:${endpoint.id}` ? "已复制" : "复制" }}
                        </button>
                    </div>
                </div>

                <div v-if="guide.reverseTargets.length" class="reverse-summary">
                    <strong>OneBots 主动连接</strong>
                    <span v-for="target in guide.reverseTargets" :key="target.label"
                        >{{ target.label }} × {{ target.count }}</span
                    >
                    <small>这些目标会由 OneBots 主动连接，不需要把上方地址填回 OneBots。</small>
                </div>
                <p class="auth-summary" :class="{ configured: guide.authConfigured }">
                    <IconCheck v-if="guide.authConfigured" :size="16" aria-hidden="true" />
                    <IconAlertTriangle v-else :size="16" aria-hidden="true" />
                    {{
                        guide.authConfigured
                            ? "鉴权 Token 已配置；请在下游填写同一个值。"
                            : "未检测到 Token。公开到局域网或公网前，建议先配置鉴权。"
                    }}
                </p>
                <p v-if="guide.warning" class="connection-warning">
                    <IconAlertTriangle :size="17" aria-hidden="true" />{{ guide.warning }}
                </p>
            </article>
        </div>
    </section>
</template>

<style scoped src="../styles/control-connections.css"></style>
