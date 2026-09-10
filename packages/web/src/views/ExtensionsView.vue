<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import { IconPackage } from "@tabler/icons-vue";
import ControlInstallationPanel from "../components/ControlInstallationPanel.vue";

defineProps<{ client: ControlClient }>();
const emit = defineEmits<{ applied: [] }>();
</script>

<template>
    <section class="workspace-view" aria-labelledby="extensions-title">
        <header class="page-heading">
            <div>
                <p class="eyebrow">IMMUTABLE RUNTIME</p>
                <h1 id="extensions-title">扩展版本</h1>
                <p>选择适配器与协议，生成候选运行版本并显式激活。</p>
            </div>
            <IconPackage :size="28" />
        </header>
        <div class="panel-stack">
            <ControlInstallationPanel :client="client" @applied="emit('applied')" />
        </div>
    </section>
</template>
