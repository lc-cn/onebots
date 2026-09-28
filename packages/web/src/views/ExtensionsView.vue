<script setup lang="ts">
import type { ControlClient } from "@onebots/core/control";
import ControlInstallationPanel from "../components/ControlInstallationPanel.vue";
import type { ControlMutationBlock } from "../control-product-state.js";
import type { ExtensionCategory } from "../control-workspace.js";

defineProps<{
    client: ControlClient;
    mutationBlock?: ControlMutationBlock;
    category: ExtensionCategory;
}>();
const emit = defineEmits<{ applied: []; categoryChange: [category: ExtensionCategory] }>();
</script>

<template>
    <section class="workspace-view" aria-label="扩展">
        <div class="panel-stack">
            <ControlInstallationPanel
                :client="client"
                :mutation-block="mutationBlock"
                :category="category"
                @category-change="emit('categoryChange', $event)"
                @applied="emit('applied')" />
        </div>
    </section>
</template>
