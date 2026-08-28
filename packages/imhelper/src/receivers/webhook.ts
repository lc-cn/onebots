import http from "node:http";
import type { Adapter } from "../adapter.js";
import { acceptHttpIngress } from "../ingress.js";
import { Receiver, type AuthenticatedReceiverOptions } from "../receiver.js";
import { readReceiverToken } from "./auth.js";

/** 在独立 HTTP 端口上接收 Webhook；已有 HTTP 宿主应优先使用 Client.acceptHttp。 */
export class WebhookReceiver<
    Id extends string | number = string | number,
    TRawEvent = unknown,
> extends Receiver<Id, TRawEvent> {
    #server?: http.Server;

    constructor(
        adapter: Adapter<Id, TRawEvent>,
        public readonly path: string,
        private readonly options: AuthenticatedReceiverOptions = {},
    ) {
        super(adapter, options.logger);
    }

    async connect(port = 8080): Promise<void> {
        if (this.#server) throw new Error("Webhook Receiver 已启动");

        const server = http.createServer((request, response) => {
            const requestUrl = new URL(request.url ?? "/", "http://localhost");
            if (requestUrl.pathname !== this.path) {
                response.writeHead(404);
                response.end();
                return;
            }
            if (
                this.options.accessToken &&
                readReceiverToken(request.url, request.headers) !== this.options.accessToken
            ) {
                response.writeHead(401, { "content-type": "application/json; charset=utf-8" });
                response.end(JSON.stringify({ status: "error", message: "鉴权失败" }));
                return;
            }

            void acceptHttpIngress<TRawEvent>(request, response, event => this.ingest(event)).catch(
                error => this.logger.error("处理 Webhook 请求失败", error),
            );
        });
        this.#server = server;

        try {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(port, () => {
                    server.off("error", reject);
                    resolve();
                });
            });
        } catch (error) {
            if (this.#server === server) this.#server = undefined;
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        const server = this.#server;
        this.#server = undefined;
        if (!server) return;
        await new Promise<void>((resolve, reject) => {
            server.close(error => (error ? reject(error) : resolve()));
        });
    }
}
