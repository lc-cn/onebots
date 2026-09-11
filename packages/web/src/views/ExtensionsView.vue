<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import ControlInstallationPanel from "../components/ControlInstallationPanel.vue";
import ControlSetupJourney from "../components/ControlSetupJourney.vue";
import type { ControlMutationBlock, SetupJourney } from "../control-product-state.js";
import type { Workspace } from "../control-workspace.js";

defineProps<{
    client: ControlClient;
    journey: SetupJourney;
    mutationBlock?: ControlMutationBlock;
}>();
const emit = defineEmits<{ applied: []; select: [workspace: Workspace] }>();
</script>

<template>
    <section class="workspace-view" aria-labelledby="extensions-title">
        <header class="page-heading">
            <div>
                <h1 id="extensions-title">安装与扩展</h1>
                <p>选择平台适配器、输出协议和框架支持，并统一检查依赖后安装。</p>
            </div>
        </header>
        <ControlSetupJourney
            v-if="journey.state !== 'running'"
            compact
            :journey="journey"
            @select="emit('select', $event)" />
        <div class="panel-stack">
            <ControlInstallationPanel
                :client="client"
                :mutation-block="mutationBlock"
                @applied="emit('applied')" />
        </div>
    </section>
</template>
