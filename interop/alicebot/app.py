import asyncio
import json
import os
from importlib.metadata import version
from pathlib import Path
from types import SimpleNamespace

from aiohttp import web
from alicebot.adapter.cqhttp import CQHTTPAdapter
from alicebot.adapter.cqhttp.config import Config


HOST = "127.0.0.1"
PORT = int(os.environ["ONEBOTS_INTEROP_FRAMEWORK_PORT"])
TOKEN = os.environ["ONEBOTS_INTEROP_TOKEN"]
EVIDENCE_FILE = Path(os.environ["ONEBOTS_INTEROP_EVIDENCE"])


class AuthenticatedCQHTTPAdapter(CQHTTPAdapter):
    """修复 AliceBot 0.11.0 在 WebSocket 升级后读取响应头的鉴权缺陷。"""

    async def handle_reverse_ws_response(self, request: web.Request) -> web.StreamResponse:
        configured = self.config.access_token
        supplied = request.query.get("access_token")
        authorization = request.headers.get("Authorization", "")
        if configured and supplied != configured and authorization != f"Bearer {configured}":
            return web.Response(status=401, text="Unauthorized")

        self.websocket = web.WebSocketResponse()
        await self.websocket.prepare(request)
        await self.handle_websocket()
        return self.websocket


class FixtureBot:
    def __init__(self) -> None:
        adapter_config = SimpleNamespace(
            cqhttp=Config(
                adapter_type="reverse-ws",
                host=HOST,
                port=PORT,
                url="/cqhttp/ws",
                access_token=TOKEN,
            )
        )
        self.config = SimpleNamespace(adapter=adapter_config)
        self.capture_task: asyncio.Task[None] | None = None

    async def handle_event(self, event, **_kwargs) -> None:
        if getattr(event, "post_type", None) == "message" and self.capture_task is None:
            self.capture_task = asyncio.create_task(capture(event))


async def capture(event) -> None:
    login = await event.adapter.call_api("get_login_info")
    sent = await event.adapter.call_api(
        "send_private_msg",
        user_id=event.user_id,
        message=[{"type": "text", "data": {"text": "onebots-alicebot-interop-reply"}}],
    )
    evidence = {
        "framework": "alicebot",
        "frameworkVersion": version("alicebot"),
        "adapterVersion": version("alicebot-adapter-cqhttp"),
        "event": {
            "postType": event.post_type,
            "messageType": event.message_type,
            "plainText": event.raw_message,
            "messageId": event.message_id,
        },
        "login": login,
        "send": sent,
    }
    temporary = EVIDENCE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(evidence, ensure_ascii=False), encoding="utf-8")
    temporary.replace(EVIDENCE_FILE)


async def main() -> None:
    adapter = AuthenticatedCQHTTPAdapter(FixtureBot())
    await adapter.startup()
    try:
        await adapter.run()
        await asyncio.Event().wait()
    finally:
        await adapter.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
