<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import ControlConfigurationPanel from "../components/ControlConfigurationPanel.vue";
import type { ControlMutationBlock } from "../control-product-state.js";
import type { Workspace } from "../control-workspace.js";
import type {
    ConfigurationNavigationTarget,
    ConfigurationScope,
} from "../components/control-configuration-layout.js";

defineProps<{
    client: ControlClient;
    mutationBlock?: ControlMutationBlock;
    gatewayRunning?: boolean;
    target?: ConfigurationNavigationTarget;
    scope: ConfigurationScope;
}>();
const emit = defineEmits<{
    applied: [];
    dirtyChange: [dirty: boolean];
    select: [workspace: Workspace];
    navigateScope: [scope: ConfigurationScope];
    close: [];
}>();
const scopeLabels: Record<ConfigurationScope, string> = {
    accounts: "账号",
    protocols: "协议",
    runtime: "系统运行",
};
</script>

<template>
    <section class="configuration-owner-editor" :aria-label="`${scopeLabels[scope]}配置编辑区`">
        <div class="panel-stack">
            <ControlConfigurationPanel
                :client="client"
                :mutation-block="mutationBlock"
                :gateway-running="gatewayRunning"
                :target="target"
                :scope="scope"
                @dirty-change="emit('dirtyChange', $event)"
                @applied="emit('applied')"
                @select-extensions="emit('select', 'extensions')"
                @select-accounts="emit('select', 'accounts')"
                @navigate-scope="emit('navigateScope', $event)"
                @close="emit('close')" />
        </div>
    </section>
</template>
