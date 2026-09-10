<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import { IconBell, IconBug, IconFileText } from "@tabler/icons-vue";
import ControlLogsPanel from "../components/ControlLogsPanel.vue";
import ControlMessageDebugPanel from "../components/ControlMessageDebugPanel.vue";
import ControlVerificationPanel from "../components/ControlVerificationPanel.vue";

defineProps<{ client: ControlClient; gatewayInstanceId?: string }>();
</script>

<template>
    <section class="workspace-view" aria-labelledby="activity-title">
        <header class="page-heading">
            <div>
                <p class="eyebrow">OPERATE & OBSERVE</p>
                <h1 id="activity-title">运行与诊断</h1>
                <p>处理账号验证、检查消息流，并读取管理服务与网关日志。</p>
            </div>
            <div class="heading-icons">
                <IconBell :size="22" /><IconBug :size="22" /><IconFileText :size="22" />
            </div>
        </header>
        <div class="panel-grid">
            <ControlVerificationPanel :client="client" :gateway-instance-id="gatewayInstanceId" />
            <ControlMessageDebugPanel :client="client" :gateway-instance-id="gatewayInstanceId" />
            <ControlLogsPanel :client="client" />
        </div>
    </section>
</template>
