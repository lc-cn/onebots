<script setup lang="ts">
import { IconAlertTriangle, IconChevronRight, IconMoon, IconSun } from "@tabler/icons-vue";
import UiButton from "../ui/UiButton.vue";
import UiInput from "../ui/UiInput.vue";

defineProps<{ busy: boolean; error: string; isDark: boolean }>();
const code = defineModel<string>({ required: true });
const emit = defineEmits<{ pair: []; toggleTheme: [] }>();
</script>

<template>
    <main class="auth-shell">
        <section class="auth-story" aria-labelledby="auth-title">
            <div class="brand-lockup">
                <span class="brand-mark" aria-hidden="true">OB</span>
                <span>onebots <small>control</small></span>
            </div>
            <div class="auth-story-copy">
                <p class="eyebrow">SELF-HOSTED IM CONTROL PLANE</p>
                <h1 id="auth-title">运行你的<br />消息网关</h1>
                <p>在一个本地控制面中管理平台账号、协议出口与网关生命周期。</p>
            </div>
            <div class="auth-principles" aria-label="产品特性">
                <div>
                    <span>01</span>
                    <p><strong>数据留在本地</strong><small>配置与凭据保存在你的工作区</small></p>
                </div>
                <div>
                    <span>02</span>
                    <p><strong>设备独立授权</strong><small>每个管理会话均可单独撤销</small></p>
                </div>
                <div>
                    <span>03</span>
                    <p><strong>网关独立运行</strong><small>停止网关不影响管理服务</small></p>
                </div>
            </div>
        </section>
        <section class="auth-panel">
            <button
                type="button"
                class="icon-button absolute right-5 top-5"
                :aria-label="isDark ? '切换为浅色模式' : '切换为深色模式'"
                @click="emit('toggleTheme')">
                <IconSun v-if="isDark" :size="18" />
                <IconMoon v-else :size="18" />
            </button>
            <form class="auth-form" @submit.prevent="emit('pair')">
                <div>
                    <div class="auth-step"><span>设备授权</span><span>01 / 01</span></div>
                    <h2>授权此设备</h2>
                    <p class="mt-3 text-fg-secondary">
                        使用管理服务生成的一次性代码，建立此浏览器的独立管理会话。
                    </p>
                </div>
                <div v-if="error" role="alert" class="feedback feedback-error">
                    <IconAlertTriangle :size="18" /><span>{{ error }}</span>
                </div>
                <label class="space-y-2" for="pair-code">
                    <span class="text-sm font-medium">一次性授权码</span>
                    <UiInput
                        id="pair-code"
                        v-model="code"
                        type="password"
                        autocomplete="off"
                        placeholder="输入设备码或恢复码" />
                </label>
                <UiButton type="submit" variant="primary" :loading="busy" :disabled="!code.trim()">
                    连接管理服务 <IconChevronRight :size="16" />
                </UiButton>
                <p class="auth-expiry">授权码 5 分钟后失效 · 不会挤掉已有设备</p>
                <details class="auth-help">
                    <summary>如何获取授权码</summary>
                    <div class="space-y-4 pt-4">
                        <p>
                            <strong>首次安装</strong
                            ><code>onebots auth bootstrap --data-dir &lt;工作区&gt;</code>
                        </p>
                        <p>
                            <strong>添加设备</strong
                            ><code>onebots auth device --data-dir &lt;工作区&gt;</code>
                        </p>
                        <p>
                            <strong>恢复访问</strong
                            ><code>onebots auth recover --data-dir &lt;工作区&gt;</code>
                        </p>
                        <p class="text-xs text-fg-tertiary">
                            恢复访问会撤销所有旧设备。Docker 环境可通过 docker exec 运行命令。
                        </p>
                    </div>
                </details>
            </form>
        </section>
    </main>
</template>
