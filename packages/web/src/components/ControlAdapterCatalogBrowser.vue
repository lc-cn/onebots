<script setup lang="ts">
import { computed, ref } from "vue";
import type { ControlAdapterCatalogEntry } from "@onebots/core/control";
import {
    filterAdapterCatalog,
    groupAdapterCatalog,
    previewAdapterCatalogGroups,
    selectedAdapterEntries,
    type AdapterCatalogFilter,
    type AdapterCatalogGroupKey,
} from "./control-adapter-catalog.js";

const props = defineProps<{
    entries: ControlAdapterCatalogEntry[];
    installed?: string[];
    disabled?: boolean;
}>();
const selected = defineModel<string[]>({ required: true });
const query = ref("");
const filter = ref<AdapterCatalogFilter>("all");
const installedCount = computed(
    () => props.entries.filter(entry => props.installed?.includes(entry.name)).length,
);
const filteredEntries = computed(() =>
    filterAdapterCatalog(props.entries, props.installed ?? [], filter.value),
);
const groups = computed(() => groupAdapterCatalog(filteredEntries.value, query.value));
const expandedGroups = ref(new Set<AdapterCatalogGroupKey>());
const displayedGroups = computed(() =>
    previewAdapterCatalogGroups(
        groups.value,
        selected.value,
        props.installed ?? [],
        query.value.trim() ? new Set(groups.value.map(group => group.key)) : expandedGroups.value,
    ),
);
const selectedEntries = computed(() => selectedAdapterEntries(props.entries, selected.value));
const filters: Array<{ id: AdapterCatalogFilter; label: string }> = [
    { id: "all", label: "全部" },
    { id: "installed", label: "已安装" },
    { id: "not-installed", label: "未安装" },
];
function filterCount(id: AdapterCatalogFilter): number {
    if (id === "installed") return installedCount.value;
    if (id === "not-installed") return props.entries.length - installedCount.value;
    return props.entries.length;
}
const categories = [
    { key: "actions", label: "动作" },
    { key: "events", label: "事件" },
    { key: "segments", label: "消息段" },
    { key: "transports", label: "连接" },
] as const;

function supportedNames(
    entry: ControlAdapterCatalogEntry,
    category: (typeof categories)[number]["key"],
) {
    return Object.entries(entry.capabilitySnapshot?.manifest[category] ?? {})
        .filter(([, descriptor]) => descriptor.support !== "unsupported")
        .map(([name]) => name);
}

function supportedCount(
    entry: ControlAdapterCatalogEntry,
    category: (typeof categories)[number]["key"],
) {
    return entry.capabilitySnapshot?.summary[category].supported;
}

function unselect(name: string) {
    selected.value = selected.value.filter(selectedName => selectedName !== name);
}

function toggleGroup(key: AdapterCatalogGroupKey) {
    const next = new Set(expandedGroups.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedGroups.value = next;
}

function resetBrowse() {
    query.value = "";
    filter.value = "all";
}
</script>

<template>
    <fieldset class="adapter-catalog">
        <legend>平台适配器</legend>
        <div class="adapter-catalog-toolbar">
            <label>
                <span>搜索平台、能力或依赖</span>
                <input
                    v-model="query"
                    type="search"
                    name="adapter-search"
                    autocomplete="off"
                    placeholder="例如 Telegram、send_message…"
                    class="adapter-catalog-search" />
            </label>
            <p>共 {{ entries.length }} 个适配器，无需先创建 Bot 即可浏览</p>
        </div>
        <div class="adapter-catalog-filters" role="group" aria-label="按安装状态筛选平台">
            <button
                v-for="item in filters"
                :key="item.id"
                type="button"
                :aria-pressed="filter === item.id"
                :class="{ active: filter === item.id }"
                @click="filter = item.id">
                {{ item.label }} <span>{{ filterCount(item.id) }}</span>
            </button>
        </div>

        <div v-if="selectedEntries.length" class="adapter-catalog-selected">
            <p class="text-xs font-medium text-fg-secondary">
                已选 {{ selectedEntries.length }} 个平台
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
                <button
                    v-for="entry in selectedEntries"
                    :key="entry.name"
                    type="button"
                    class="adapter-selected-item"
                    :disabled="disabled"
                    :aria-label="`取消选择 ${entry.displayName}`"
                    @click="unselect(entry.name)">
                    {{ entry.displayName }} ×
                </button>
            </div>
        </div>

        <div v-if="groups.length" class="adapter-catalog-groups">
            <section v-for="group in displayedGroups" :key="group.key" class="adapter-group">
                <header>
                    <h2 class="text-sm font-medium">{{ group.label }}</h2>
                    <p class="mt-1 text-xs text-fg-muted">{{ group.description }}</p>
                </header>
                <div class="adapter-list">
                    <article v-for="entry in group.entries" :key="entry.name" class="adapter-row">
                        <label
                            :for="`adapter-${entry.name}`"
                            class="flex min-h-11 cursor-pointer items-start gap-3">
                            <input
                                :id="`adapter-${entry.name}`"
                                v-model="selected"
                                type="checkbox"
                                :disabled="disabled"
                                :value="entry.name"
                                :aria-label="`选择 ${entry.displayName}`"
                                class="mt-1 accent-accent" />
                            <span class="adapter-monogram" aria-hidden="true">{{
                                entry.displayName.slice(0, 2)
                            }}</span>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-baseline justify-between gap-2">
                                    <h3 class="text-sm font-medium">{{ entry.displayName }}</h3>
                                    <span class="font-mono text-[0.68rem] text-fg-muted"
                                        >{{
                                            props.installed?.includes(entry.name)
                                                ? "当前安装"
                                                : "目录"
                                        }}
                                        v{{ entry.version }}</span
                                    >
                                </div>
                                <p class="mt-1.5 text-xs leading-5 text-fg-secondary">
                                    {{ entry.description || "此管理服务未提供适配器说明。" }}
                                </p>
                                <div class="adapter-capability-summary">
                                    <span
                                        v-for="category in categories"
                                        :key="category.key"
                                        class="adapter-capability-value">
                                        {{ category.label }}
                                        {{ supportedCount(entry, category.key) ?? "—" }}
                                    </span>
                                    <span
                                        v-if="entry.peerDependencies?.length"
                                        class="adapter-capability-value">
                                        必需依赖 {{ entry.peerDependencies.length }}
                                    </span>
                                    <span
                                        v-if="entry.requirements?.length"
                                        class="adapter-capability-value warning">
                                        需下载授权
                                    </span>
                                </div>
                            </div>
                        </label>
                        <details class="mt-3 border-t border-border pt-3 text-xs">
                            <summary class="cursor-pointer select-none text-fg-secondary">
                                查看能力与安装前准备
                            </summary>
                            <div class="mt-3 space-y-4">
                                <section v-if="entry.requirements?.length" class="space-y-2">
                                    <h4 class="font-medium">下载要求</h4>
                                    <div
                                        v-for="requirement in entry.requirements"
                                        :key="requirement.scope"
                                        class="rounded-control border border-border p-3">
                                        <p class="font-medium">{{ requirement.title }}</p>
                                        <p class="mt-1 leading-5 text-fg-secondary">
                                            {{ requirement.description }}
                                        </p>
                                        <p class="mt-1 font-mono text-fg-muted">
                                            {{ requirement.scope }} · {{ requirement.permission }}
                                        </p>
                                    </div>
                                </section>
                                <section v-if="entry.peerDependencies?.length" class="space-y-2">
                                    <h4 class="font-medium">随适配器一并安装</h4>
                                    <p
                                        v-for="peer in entry.peerDependencies"
                                        :key="peer.packageName"
                                        class="font-mono text-fg-secondary">
                                        {{ peer.packageName }} {{ peer.range }}
                                    </p>
                                </section>
                                <section v-if="entry.setup?.length" class="space-y-2">
                                    <h4 class="font-medium">平台准备</h4>
                                    <ol class="space-y-2">
                                        <li
                                            v-for="(step, index) in entry.setup"
                                            :key="`${entry.name}:${index}`"
                                            class="leading-5 text-fg-secondary">
                                            <span class="font-medium text-fg"
                                                >{{ index + 1 }}. {{ step.title }}</span
                                            >
                                            — {{ step.description }}
                                            <a
                                                v-if="step.url"
                                                :href="step.url"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="ml-1 text-accent hover:underline"
                                                >参考文档</a
                                            >
                                        </li>
                                    </ol>
                                </section>
                                <section
                                    v-if="entry.capabilitySnapshot"
                                    class="grid gap-3 sm:grid-cols-2">
                                    <div
                                        v-for="category in categories"
                                        :key="category.key"
                                        class="min-w-0">
                                        <h4 class="font-medium">
                                            {{ category.label }} ·
                                            {{ supportedCount(entry, category.key) }}
                                        </h4>
                                        <p
                                            class="mt-1 break-words font-mono leading-5 text-fg-muted">
                                            {{
                                                supportedNames(entry, category.key).join(" · ") ||
                                                "暂无"
                                            }}
                                        </p>
                                    </div>
                                </section>
                                <p v-if="entry.capabilitySnapshot" class="text-fg-muted">
                                    能力快照对应
                                    {{
                                        entry.capabilitySnapshot.packageVersion
                                    }}；账号实际能力还受权限和连接上下文影响。
                                </p>
                                <p v-else class="rounded-control bg-warning-soft p-3 text-warning">
                                    当前运行版本没有与其精确版本匹配的能力快照。这里不会用管理服务自带的其他版本资料代替；升级运行版本后可重新查看。
                                </p>
                            </div>
                        </details>
                    </article>
                </div>
                <button
                    v-if="!query.trim() && (group.hiddenCount || expandedGroups.has(group.key))"
                    type="button"
                    class="adapter-group-toggle"
                    :aria-expanded="expandedGroups.has(group.key)"
                    @click="toggleGroup(group.key)">
                    {{
                        expandedGroups.has(group.key)
                            ? "收起列表"
                            : `显示其余 ${group.hiddenCount} 个`
                    }}
                </button>
            </section>
        </div>
        <div
            v-else
            class="rounded-control border border-dashed border-border p-5 text-center text-sm text-fg-muted">
            <p>
                {{
                    query.trim()
                        ? "没有匹配的平台，请换个名称或能力关键词。"
                        : filter === "installed"
                          ? "尚未安装平台，可以查看未安装的平台。"
                          : "当前分类没有平台。"
                }}
            </p>
            <button
                v-if="query.trim() || filter !== 'all'"
                type="button"
                class="mt-3 min-h-11 rounded-control border border-border-strong px-4 text-fg"
                @click="resetBrowse">
                查看全部平台
            </button>
        </div>
        <p
            v-if="selected.some(name => !entries.some(entry => entry.name === name))"
            class="text-xs text-danger">
            当前集合含目录外适配器，已保留选择；请先由管理员核查。
        </p>
    </fieldset>
</template>
