<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import { IconPackage } from "@tabler/icons-vue";
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
                <p class="eyebrow">PLATFORMS · PROTOCOLS · FRAMEWORKS</p>
                <h1 id="extensions-title">安装与扩展</h1>
                <p>先了解能力和配置要求，再选择平台、输出协议与框架支持。</p>
            </div>
            <IconPackage :size="28" aria-hidden="true" />
        </header>
        <ControlSetupJourney
            v-if="journey.state !== 'running'"
            compact
            :journey="journey"
            @select="emit('select', $event)" />
        <ol class="workflow-rail" aria-label="扩展版本流程">
            <li>
                <span>01</span>
                <div><strong>了解并选择</strong><small>能力、凭据与连接方式</small></div>
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
            <ControlInstallationPanel
                :client="client"
                :mutation-block="mutationBlock"
                @applied="emit('applied')" />
        </div>
    </section>
</template>
