import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
    ControlAccountExploreResult,
    ControlAccountItem,
    ControlClient,
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlSendContext,
    ControlStatus,
} from "@onebots/core/control";
import { buildAccountCards } from "./account-overview.js";
import {
    accountControlCategories,
    accountControlSceneType,
    emptyAccountControlList,
    filterAccountControlItems,
    manualAccountTargetLabel,
    type AccountControlCategory,
    type AccountControlConversationItem,
    type AccountControlListState,
    type AccountControlTab,
} from "./account-control-list.js";
import { useAccountSend } from "./use-account-send.js";
import { useAccountRecent } from "./use-account-recent.js";
import { useAccountHistory } from "./use-account-history.js";
import { useAccountDetail } from "./use-account-detail.js";
import { useAccountMembers } from "./use-account-members.js";

type Category = AccountControlCategory;
type Tab = AccountControlTab;
type ListState = AccountControlListState;
const emptyList = emptyAccountControlList;

export interface AccountControlProps {
    client: ControlClient;
    platform: string;
    accountId: string;
    status?: ControlStatus;
    statusError?: string;
    configuration?: ControlConfigurationSnapshot;
    catalog?: ControlInstallationCatalog;
}
export function useAccountControl(props: AccountControlProps) {
    const account = computed(() =>
        buildAccountCards(
            props.configuration,
            props.status,
            props.catalog,
            window.location.origin,
        ).find(card => card.platform === props.platform && card.accountId === props.accountId),
    );
    const online = computed(() => account.value?.status === "online");
    const gatewayInstanceId = computed(() => props.status?.gateway.instance?.id);
    const context = ref<ControlSendContext>();
    const category = ref<Tab>("recent");
    const lists = ref<Record<Category, ListState>>({
        friend: emptyList(),
        group: emptyList(),
        channel: emptyList(),
    });
    const selectedGuild = ref<ControlAccountItem>();
    const channelListMode = ref(false);
    const channels = ref<ListState>(emptyList());
    const selected = ref<AccountControlConversationItem>();
    const manualId = ref("");
    const contactSearch = ref("");
    const sendScenes = ref<Record<"private" | "direct" | "group" | "channel", boolean>>();
    let selectionRevision = 0;
    let accountRevision = 0;
    let channelRequestRevision = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    const {
        recent,
        hasMore: recentHasMore,
        olderLoading: recentOlderLoading,
        olderError: recentOlderError,
        load: loadRecent,
        loadOlder: loadOlderRecent,
        reset: resetRecent,
        invalidate: invalidateRecent,
        shouldRefresh: shouldRefreshRecent,
    } = useAccountRecent({
        client: props.client,
        platform: () => props.platform,
        accountId: () => props.accountId,
        online,
        revision: () => accountRevision,
        disposed: () => disposed,
    });
    const {
        messages,
        loading: historyLoading,
        error: historyError,
        retryOlder: historyRetryOlder,
        hasMore: moreHistory,
        load: loadHistory,
        reset: resetHistory,
    } = useAccountHistory({
        client: props.client,
        platform: () => props.platform,
        accountId: () => props.accountId,
        selected,
        online,
        revision: () => selectionRevision,
        disposed: () => disposed,
        onRevisionChange: () => {
            invalidateRecent();
        },
    });
    const {
        detail,
        supported: detailSupported,
        loading: detailLoading,
        error: detailError,
        load: loadDetail,
        reset: resetDetail,
    } = useAccountDetail({
        client: props.client,
        account: () => `${props.platform}/${props.accountId}`,
        ensureContext,
        revision: () => selectionRevision,
        disposed: () => disposed,
        onCapabilities: applyCapabilities,
    });
    const {
        members,
        loaded: membersLoaded,
        supported: membersSupported,
        truncated: membersTruncated,
        loading: memberLoading,
        error: memberError,
        load: loadMembers,
        reset: resetMembers,
    } = useAccountMembers({
        client: props.client,
        account: () => `${props.platform}/${props.accountId}`,
        ensureContext,
        revision: () => selectionRevision,
        disposed: () => disposed,
        onCapabilities: applyCapabilities,
    });

    function applyCapabilities(result: Pick<ControlAccountExploreResult, "sendScenes">) {
        sendScenes.value = result.sendScenes;
    }

    const categories = accountControlCategories;
    const visibleList = computed(() =>
        category.value === "recent"
            ? recent.value
            : category.value === "channel" && selectedGuild.value
              ? channels.value
              : lists.value[category.value],
    );
    const filteredItems = computed(() =>
        filterAccountControlItems(visibleList.value.items, contactSearch.value),
    );
    const manualTargetLabel = computed(() =>
        manualAccountTargetLabel(
            category.value === "recent" ? "friend" : category.value,
            Boolean(selectedGuild.value),
            channelListMode.value,
        ),
    );
    const activeItem = computed(() => detail.value ?? selected.value);
    const sceneType = computed(
        () => selected.value?.sceneType ?? accountControlSceneType(selected.value?.kind),
    );
    const canSendScene = computed(() =>
        Boolean(
            selected.value &&
            selected.value.kind !== "guild" &&
            sendScenes.value?.[sceneType.value] === true,
        ),
    );
    // 状态刷新失败时保留已读会话，但不能用过期的“在线”快照授权新发送。
    const canChat = computed(() => canSendScene.value && !props.statusError);
    const sendCapabilityPending = computed(() => Boolean(selected.value && !sendScenes.value));
    const sendCapabilityLoading = computed(() => lists.value.friend.loading);
    const sendUnsupported = computed(() =>
        Boolean(selected.value && sendScenes.value && !canSendScene.value),
    );

    /** 账号、分类及会话切换共用这一状态边界，旧请求由 revision 一并失效。 */
    function clearSelection() {
        selectionRevision++;
        resetHistory();
        selected.value = undefined;
        resetDetail();
        resetMembers();
    }

    function resetForGateway() {
        accountRevision++;
        channelRequestRevision++;
        clearSelection();
        context.value = undefined;
        manualId.value = "";
        selectedGuild.value = undefined;
        channelListMode.value = false;
        sendScenes.value = undefined;
        contactSearch.value = "";
        channels.value = emptyList();
        resetRecent();
        lists.value = {
            friend: emptyList(),
            group: emptyList(),
            channel: emptyList(),
        };
    }

    async function ensureContext(): Promise<ControlSendContext | undefined> {
        if (context.value?.gatewayInstanceId === gatewayInstanceId.value) return context.value;
        try {
            const next = await props.client.sendContext();
            if (disposed || !online.value || next.gatewayInstanceId !== gatewayInstanceId.value)
                return;
            context.value = next;
            return next;
        } catch {
            return undefined;
        }
    }

    async function loadList(kind: Category, force = false) {
        const state = lists.value[kind];
        if (!online.value || state.loading || (state.loaded && !force)) return;
        const revision = accountRevision;
        state.loading = true;
        state.error = "";
        const expected = await ensureContext();
        if (disposed || revision !== accountRevision) return;
        if (!expected) {
            state.error = "网关连接暂不可用，请稍后刷新。";
            state.loading = false;
            return;
        }
        try {
            const action = kind === "friend" ? "friends" : kind === "group" ? "groups" : "guilds";
            let result = await props.client.exploreAccount({
                expected,
                account: `${props.platform}/${props.accountId}`,
                action,
                kind: kind === "channel" ? "guild" : kind,
            });
            if (disposed || revision !== accountRevision) return;
            sendScenes.value = result.sendScenes;
            if (kind === "channel") channelListMode.value = !result.supported;
            // Slack、IRCv3、Twitch 等无服务器目录，但可直接列出频道。
            if (kind === "channel" && !result.supported) {
                result = await props.client.exploreAccount({
                    expected,
                    account: `${props.platform}/${props.accountId}`,
                    action: "channels",
                    kind: "channel",
                });
                if (disposed || revision !== accountRevision) return;
                sendScenes.value = result.sendScenes;
            }
            state.items = result.items;
            state.supported = result.supported;
            state.truncated = result.truncated;
            state.loaded = true;
        } catch {
            if (disposed || revision !== accountRevision) return;
            state.error = "列表读取失败，请重试。";
        } finally {
            if (revision === accountRevision) state.loading = false;
        }
    }

    async function loadChannels(guild: ControlAccountItem, refresh = false) {
        if (refresh && channels.value.loading) return;
        if (!refresh) clearSelection();
        const request = ++channelRequestRevision;
        if (!refresh) {
            selectedGuild.value = guild;
            contactSearch.value = "";
            channels.value = emptyList();
        }
        channels.value.loading = true;
        channels.value.error = "";
        const revision = accountRevision;
        const isCurrent = () =>
            !disposed &&
            revision === accountRevision &&
            request === channelRequestRevision &&
            selectedGuild.value?.id === guild.id;
        const expected = await ensureContext();
        if (!isCurrent()) return;
        if (!expected) {
            channels.value.error = "网关连接暂不可用。";
            channels.value.loading = false;
            return;
        }
        try {
            const result = await props.client.exploreAccount({
                expected,
                account: `${props.platform}/${props.accountId}`,
                action: "channels",
                kind: "channel",
                guildId: guild.id,
            });
            if (!isCurrent()) return;
            channels.value = {
                items: result.items,
                supported: result.supported,
                truncated: result.truncated,
                loaded: true,
                loading: false,
                error: "",
            };
            sendScenes.value = result.sendScenes;
        } catch {
            if (isCurrent()) channels.value.error = "频道读取失败，请重试。";
        } finally {
            if (isCurrent()) channels.value.loading = false;
        }
    }

    function leaveGuild() {
        channelRequestRevision++;
        clearSelection();
        selectedGuild.value = undefined;
        contactSearch.value = "";
    }

    async function refreshVisibleList() {
        if (visibleList.value.loading) return;
        if (selectedGuild.value) return loadChannels(selectedGuild.value, true);
        if (category.value === "recent") {
            // 最近会话不经过平台目录；同时重试能力读取，避免发送状态一直停在“未确认”。
            await Promise.all([loadRecent(true), loadList("friend", true)]);
            return;
        }
        await loadList(category.value, true);
    }

    async function choose(item: AccountControlConversationItem) {
        if (item.kind === "guild") {
            await loadChannels(item);
            return;
        }
        clearSelection();
        selected.value = item;
        const revision = selectionRevision;
        void loadHistory(false, revision);
        if (item.sceneType === "direct") return;
        const expected = await ensureContext();
        if (disposed || revision !== selectionRevision) return;
        if (!expected) {
            detailError.value = "网关连接暂不可用，仍可查看已保存的聊天记录。";
            return;
        }
        await loadDetail(item, expected, revision);
        if (
            item.kind !== "friend" &&
            !disposed &&
            revision === selectionRevision &&
            !(
                typeof window.matchMedia === "function" &&
                window.matchMedia("(max-width: 700px)").matches
            )
        )
            void loadMembers(item, expected, revision);
    }

    /** 手机成员列表只在打开详情时读取；桌面侧栏出现时也可补读一次。 */
    function ensureMembersForSelection() {
        const item = selected.value;
        if (
            !item ||
            item.kind === "friend" ||
            item.sceneType === "direct" ||
            memberLoading.value ||
            membersLoaded.value ||
            memberError.value
        )
            return;
        void loadMembers(item);
    }

    function openManual() {
        if (category.value === "recent") return;
        const id = manualId.value.trim();
        if (!id || id.length > 512) return;
        if (category.value === "channel" && !selectedGuild.value && !channelListMode.value) {
            manualId.value = "";
            void loadChannels({ kind: "guild", id, name: id });
            return;
        }
        const item: AccountControlConversationItem = {
            kind: category.value,
            id,
            name: id,
            ...(selectedGuild.value ? { parentId: selectedGuild.value.id } : {}),
        };
        manualId.value = "";
        void choose(item);
    }

    const {
        text,
        sendBusy,
        sendError,
        pendingSendId,
        pendingStatus,
        pendingTargetLabel,
        hasPending,
        confirmAbandon,
        sendMessage,
        querySend,
        requestAbandon,
        cancelAbandon,
        abandonTracking,
    } = useAccountSend({
        client: props.client,
        account: () => `${props.platform}/${props.accountId}`,
        selected,
        online,
        canChat,
        ensureContext,
        refreshHistory: () => {
            void loadHistory();
            void loadRecent(true);
        },
    });

    watch(
        [online, gatewayInstanceId, () => props.platform, () => props.accountId],
        () => {
            resetForGateway();
            if (online.value) {
                void loadRecent();
                void loadList("friend");
            }
        },
        { immediate: true },
    );
    watch(category, kind => {
        contactSearch.value = "";
        clearSelection();
        selectedGuild.value = undefined;
        if (kind === "recent") void loadRecent();
        else void loadList(kind);
    });
    onMounted(() => {
        timer = setInterval(() => {
            // 失败后等待用户主动重试，避免轮询清掉错误并把“更早历史”误刷成最新页。
            if (online.value && selected.value && !historyLoading.value && !historyError.value)
                void loadHistory();
            if (category.value === "recent" && shouldRefreshRecent()) void loadRecent(true);
        }, 5000);
    });
    onUnmounted(() => {
        disposed = true;
        if (timer) clearInterval(timer);
    });
    return {
        account,
        online,
        category,
        categories,
        recent,
        recentHasMore,
        recentOlderLoading,
        recentOlderError,
        selectedGuild,
        visibleList,
        filteredItems,
        contactSearch,
        manualTargetLabel,
        selected,
        activeItem,
        members,
        membersSupported,
        membersTruncated,
        memberLoading,
        memberError,
        detailError,
        detailSupported,
        detailLoading,
        messages,
        historyLoading,
        historyError,
        historyRetryOlder,
        moreHistory,
        text,
        manualId,
        sendBusy,
        sendError,
        pendingSendId,
        pendingStatus,
        canChat,
        sendCapabilityPending,
        sendCapabilityLoading,
        sendUnsupported,
        pendingTargetLabel,
        hasPending,
        confirmAbandon,
        loadChannels,
        loadList,
        loadRecent,
        loadOlderRecent,
        loadMembers,
        ensureMembersForSelection,
        loadDetail,
        refreshVisibleList,
        leaveGuild,
        clearSelection,
        choose,
        loadHistory,
        openManual,
        sendMessage,
        querySend,
        requestAbandon,
        cancelAbandon,
        abandonTracking,
    };
}
