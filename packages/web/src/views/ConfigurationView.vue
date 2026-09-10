<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import { IconSettings } from "@tabler/icons-vue";
import ControlConfigurationPanel from "../components/ControlConfigurationPanel.vue";

defineProps<{ client: ControlClient }>();
const emit = defineEmits<{ applied: [] }>();
</script>

<template>
    <section class="workspace-view" aria-labelledby="configuration-title">
        <header class="page-heading">
            <div>
                <p class="eyebrow">ACCOUNTS & PROTOCOLS</p>
                <h1 id="configuration-title">账号与协议</h1>
                <p>编辑平台账号与协议出口草稿，校验后应用到工作区。</p>
            </div>
            <IconSettings :size="28" />
        </header>
        <div class="panel-stack">
            <ControlConfigurationPanel :client="client" @applied="emit('applied')" />
        </div>
    </section>
</template>
