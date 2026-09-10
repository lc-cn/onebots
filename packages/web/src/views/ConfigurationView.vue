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
        <ol class="workflow-rail" aria-label="配置应用流程">
            <li>
                <span>01</span>
                <div><strong>读取快照</strong><small>确认当前配置基线</small></div>
            </li>
            <li>
                <span>02</span>
                <div><strong>编辑草稿</strong><small>账号与协议出口</small></div>
            </li>
            <li>
                <span>03</span>
                <div><strong>校验并应用</strong><small>显式提交新版本</small></div>
            </li>
        </ol>
        <div class="panel-stack">
            <ControlConfigurationPanel
                :client="client"
                :mutation-block="mutationBlock"
                @dirty-change="emit('dirtyChange', $event)"
                @applied="emit('applied')" />
        </div>
    </section>
</template>
