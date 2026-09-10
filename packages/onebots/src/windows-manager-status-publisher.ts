import { isDeepStrictEqual } from "node:util";
import type { GatewayControllerState } from "./control/gateway-controller.js";
import {
    WindowsHostControlClient,
    type WindowsPublishedControlStatus,
} from "./windows-host-control-client.js";
import type { WindowsNativeStatus } from "./service-platform-windows.js";

interface WindowsStatusClient {
    status(): ReturnType<WindowsHostControlClient["status"]>;
    publish(
        control: WindowsPublishedControlStatus,
    ): ReturnType<WindowsHostControlClient["publish"]>;
    invalidate(
        manager: WindowsPublishedControlStatus["manager"],
        revision: number,
    ): ReturnType<WindowsHostControlClient["invalidate"]>;
}

/** 将已持久化的 manager/gateway 状态串行发布给受保护的原生宿主。 */
export class WindowsManagerStatusPublisher {
    private queue: Promise<void> = Promise.resolve();
    private revision = 0;
    private invalidated = false;

    constructor(
        pipeName: string,
        private readonly manager: WindowsPublishedControlStatus["manager"],
        private readonly client: WindowsStatusClient = new WindowsHostControlClient(pipeName),
    ) {}

    publish(gateway: Pick<GatewayControllerState, "desired" | "actual">): Promise<void> {
        if (this.invalidated) return this.queue;
        return this.enqueuePublish(gateway, false);
    }

    confirm(gateway: Pick<GatewayControllerState, "desired" | "actual">): Promise<void> {
        return this.enqueuePublish(gateway, true);
    }

    private enqueuePublish(
        gateway: Pick<GatewayControllerState, "desired" | "actual">,
        confirmsInvalidation: boolean,
    ): Promise<void> {
        const revision = this.nextRevision();
        const control: WindowsPublishedControlStatus = {
            revision,
            manager: structuredClone(this.manager),
            gateway: { desired: gateway.desired, actual: gateway.actual },
        };
        const result = this.queue.then(async () => {
            try {
                const response = await this.client.publish(control);
                this.assertPublished(response.state.control, control);
            } catch (error) {
                // Pipe writes are external effects: the host may commit the publication before
                // the response is lost. Read back the exact revision and identity before failing.
                const observed = await this.client.status().catch(() => undefined);
                try {
                    this.assertPublished(observed?.state.control, control);
                } catch {
                    throw error;
                }
            }
            if (confirmsInvalidation) this.invalidated = false;
        });
        this.queue = result.catch(() => undefined);
        return result;
    }

    invalidate(): Promise<void> {
        this.invalidated = true;
        const revision = this.nextRevision();
        const result = this.queue.then(async () => {
            try {
                const response = await this.client.invalidate(this.manager, revision);
                if (response.state.control !== undefined)
                    throw new Error("Windows 原生宿主未确认旧状态失效");
            } catch (error) {
                // Missing control state is already the required fail-closed result, including
                // an accepted invalidation whose acknowledgement was lost.
                const observed = await this.client.status().catch(() => undefined);
                if (!observed || observed.state.control !== undefined) throw error;
            }
        });
        this.queue = result.catch(() => undefined);
        return result;
    }

    flush(): Promise<void> {
        return this.queue;
    }

    private nextRevision(): number {
        if (this.revision >= Number.MAX_SAFE_INTEGER)
            throw new Error("Windows 管理状态 revision 已耗尽");
        this.revision += 1;
        return this.revision;
    }

    private assertPublished(
        confirmed: WindowsNativeStatus["state"]["control"],
        expected: WindowsPublishedControlStatus,
    ): void {
        if (
            !confirmed ||
            !isDeepStrictEqual(
                {
                    revision: confirmed.revision,
                    manager: confirmed.manager,
                    gateway: confirmed.gateway,
                },
                expected,
            )
        )
            throw new Error("Windows 原生宿主未确认当前管理状态");
    }
}

/** 网关写操作只有在原生宿主确认最终状态后才可向调用方返回。 */
export async function completeWindowsGatewayOperation<T>(
    operation: () => Promise<T>,
    status: () => Pick<GatewayControllerState, "desired" | "actual">,
    publisher: WindowsManagerStatusPublisher | undefined,
): Promise<T> {
    if (publisher) await publisher.invalidate();
    const result = await operation();
    if (publisher) await publisher.confirm(status());
    return result;
}
