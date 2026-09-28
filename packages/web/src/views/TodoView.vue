<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
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
    <section class="workspace-view" aria-label="待办">
        <ControlVerificationPanel
            :client="client"
            :gateway-instance-id="gatewayInstanceId"
            :active="active"
            :mutation-block="mutationBlock" />
    </section>
</template>
