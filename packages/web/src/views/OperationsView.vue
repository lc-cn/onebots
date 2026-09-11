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
    <section class="workspace-view operations-view" aria-labelledby="activity-title">
        <header class="page-heading">
            <div>
                <h1 id="activity-title">运行与诊断</h1>
                <p>处理账号验证、检查消息链路，并查看管理服务与网关的实时输出。</p>
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
