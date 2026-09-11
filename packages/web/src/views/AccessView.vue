<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import ControlSessionsPanel from "../components/ControlSessionsPanel.vue";
import UiButton from "../ui/UiButton.vue";

defineProps<{ client: ControlClient; busy: boolean; configurationDirty: boolean }>();
const emit = defineEmits<{ logout: []; reconnect: []; revokedSelf: [] }>();
</script>

<template>
    <section class="workspace-view" aria-labelledby="access-title">
        <header class="page-heading">
            <div>
                <h1 id="access-title">设备与访问</h1>
                <p>查看当前授权设备，撤销不再使用的管理会话。</p>
            </div>
        </header>
        <div class="access-layout">
            <ControlSessionsPanel
                :client="client"
                :configuration-dirty="configurationDirty"
                @revoked-self="emit('revokedSelf')" />
            <aside>
                <h2>当前浏览器</h2>
                <p>退出登录会撤销此设备的服务端会话。只清除本地凭据时，服务端会话仍然有效。</p>
                <div class="space-y-2">
                    <UiButton variant="danger" :loading="busy" @click="emit('logout')"
                        >撤销并退出</UiButton
                    >
                    <UiButton variant="ghost" @click="emit('reconnect')">仅清除本地凭据</UiButton>
                </div>
            </aside>
        </div>
    </section>
</template>
