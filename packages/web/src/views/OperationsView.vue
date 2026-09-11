<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import ControlLogsPanel from "../components/ControlLogsPanel.vue";
import ControlMessageDebugPanel from "../components/ControlMessageDebugPanel.vue";
import ControlVerificationPanel from "../components/ControlVerificationPanel.vue";
import type { ControlMutationBlock } from "../control-product-state.js";

defineProps<{
    client: ControlClient;
    gatewayInstanceId?: string;
    active: boolean;
    mutationBlock?: ControlMutationBlock;
}>();
</script>

<template>
    <section class="workspace-view" aria-labelledby="activity-title">
        <header class="page-heading">
            <div>
                <p class="eyebrow">OPERATE & OBSERVE</p>
                <h1 id="activity-title">运行与诊断</h1>
                <p>处理需要人工介入的账号验证，检查消息流，并实时观察服务输出。</p>
            </div>
        </header>
        <div class="operations-workbench">
            <ControlVerificationPanel
                :client="client"
                :gateway-instance-id="gatewayInstanceId"
                :active="active"
                :mutation-block="mutationBlock" />
            <ControlMessageDebugPanel
                :client="client"
                :gateway-instance-id="gatewayInstanceId"
                :active="active" />
        </div>
        <ControlLogsPanel :client="client" :active="active" />
    </section>
</template>
