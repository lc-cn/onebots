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
        <ol class="workflow-rail" aria-label="扩展版本流程">
            <li>
                <span>01</span>
                <div><strong>选择扩展</strong><small>适配器、协议与应用</small></div>
            </li>
            <li>
                <span>02</span>
                <div><strong>核对计划</strong><small>版本与必需依赖</small></div>
            </li>
            <li>
                <span>03</span>
                <div><strong>验证并应用</strong><small>切换不可变运行版本</small></div>
            </li>
        </ol>
        <div class="panel-stack">
            <ControlInstallationPanel :client="client" @applied="emit('applied')" />
        </div>
    </section>
</template>
