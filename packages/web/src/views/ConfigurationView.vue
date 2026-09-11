<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import { IconSettings } from "@tabler/icons-vue";
import ControlConfigurationPanel from "../components/ControlConfigurationPanel.vue";
import ControlSetupJourney from "../components/ControlSetupJourney.vue";
import type { ControlMutationBlock, SetupJourney } from "../control-product-state.js";
import type { Workspace } from "../control-workspace.js";

defineProps<{
    client: ControlClient;
    journey: SetupJourney;
    mutationBlock?: ControlMutationBlock;
}>();
const emit = defineEmits<{
    applied: [];
    dirtyChange: [dirty: boolean];
    select: [workspace: Workspace];
}>();
</script>

<template>
    <section class="workspace-view" aria-labelledby="configuration-title">
        <header class="page-heading">
            <div>
                <p class="eyebrow">ACCOUNTS & PROTOCOLS</p>
                <h1 id="configuration-title">账号与协议</h1>
                <p>编辑平台账号与协议出口草稿，校验后应用到工作区。</p>
            </div>
            <IconSettings :size="28" aria-hidden="true" />
        </header>
        <ControlSetupJourney
            v-if="journey.state !== 'running'"
            compact
            :journey="journey"
            @select="emit('select', $event)" />
        <div class="panel-stack">
            <ControlConfigurationPanel
                :client="client"
                :mutation-block="mutationBlock"
                @dirty-change="emit('dirtyChange', $event)"
                @applied="emit('applied')" />
        </div>
    </section>
</template>
