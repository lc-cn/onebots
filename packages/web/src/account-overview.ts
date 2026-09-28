import type {
    ControlAccountStatus,
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import {
    buildControlConnectionGuides,
    type ControlConnectionGuide,
} from "./components/control-connections.js";

export interface AccountProtocolCard {
    guide: ControlConnectionGuide;
    status?: NonNullable<ControlAccountStatus["protocols"]>[number]["status"];
}

export interface AccountConnectionCard {
    id: string;
    platform: string;
    accountId: string;
    platformLabel: string;
    status?: ControlAccountStatus["status"];
    avatarUrl?: string;
    platformIconUrl?: string;
    protocols: AccountProtocolCard[];
}

/** 账号头像优先；只允许无凭据、无片段的 HTTPS 图片地址。 */
export function accountImageUrl(
    card: Pick<AccountConnectionCard, "avatarUrl" | "platformIconUrl">,
    failed: ReadonlySet<string> = new Set(),
): string | undefined {
    return [card.avatarUrl, card.platformIconUrl].find(value => {
        if (!value || failed.has(value)) return false;
        try {
            const url = new URL(value);
            return url.protocol === "https:" && !url.username && !url.password && !url.hash;
        } catch {
            return false;
        }
    });
}

/** 同一份只读投影供账号列表、状态和协议地址使用，避免各页面各自拼接路由。 */
export function buildAccountCards(
    configuration: ControlConfigurationSnapshot | undefined,
    status: ControlStatus | undefined,
    catalog: ControlInstallationCatalog | undefined,
    origin: string,
): AccountConnectionCard[] {
    const configured = configuration?.document ?? {};
    const adapterNames = Object.keys(configuration?.schemas.adapters ?? {}).sort(
        (left, right) => right.length - left.length,
    );
    const runtime = status?.accounts?.items ?? [];
    const runtimeByAccount = new Map(
        runtime.map(item => [JSON.stringify([item.platform, item.accountId]), item]),
    );
    const cards = new Map<string, AccountConnectionCard>();
    const adapters = new Map(catalog?.adapters.map(item => [item.name, item]) ?? []);
    const ensureCard = (platform: string, accountId: string): AccountConnectionCard => {
        const id = JSON.stringify([platform, accountId]);
        let card = cards.get(id);
        if (!card) {
            card = {
                id,
                platform,
                accountId,
                platformLabel: adapters.get(platform)?.displayName ?? platform,
                platformIconUrl: adapters.get(platform)?.iconUrl,
                protocols: [],
            };
            cards.set(id, card);
        }
        return card;
    };

    for (const key of Object.keys(configured)) {
        const platform = adapterNames.find(name => key.startsWith(`${name}.`));
        if (platform) ensureCard(platform, key.slice(platform.length + 1));
    }
    for (const item of runtime) {
        const card = ensureCard(item.platform, item.accountId);
        card.status = item.status;
        card.avatarUrl = item.avatarUrl;
        card.platformIconUrl = item.platformIconUrl ?? card.platformIconUrl;
    }
    for (const guide of buildControlConnectionGuides(configuration, origin)) {
        const card = ensureCard(guide.platform, guide.accountId);
        const current = runtimeByAccount.get(JSON.stringify([guide.platform, guide.accountId]));
        card.protocols.push({
            guide,
            status: current?.protocols?.find(
                protocol => `${protocol.name}.${protocol.version}` === guide.protocolKey,
            )?.status,
        });
    }
    return [...cards.values()].sort((left, right) => left.id.localeCompare(right.id));
}
