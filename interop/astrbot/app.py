import asyncio
import json
import os
from importlib.metadata import version
from pathlib import Path

from astrbot.core.platform.sources.aiocqhttp.aiocqhttp_platform_adapter import (
    AiocqhttpAdapter,
)


HOST = "127.0.0.1"
PORT = int(os.environ["ONEBOTS_INTEROP_FRAMEWORK_PORT"])
TOKEN = os.environ["ONEBOTS_INTEROP_TOKEN"]
EVIDENCE_FILE = Path(os.environ["ONEBOTS_INTEROP_EVIDENCE"])


async def main() -> None:
    events: asyncio.Queue = asyncio.Queue()
    adapter = AiocqhttpAdapter(
        {
            "id": "onebots-interop",
            "ws_reverse_host": HOST,
            "ws_reverse_port": PORT,
            "ws_reverse_token": TOKEN,
        },
        {},
        events,
    )
    server = asyncio.create_task(adapter.run())
    try:
        received = await events.get()
        raw_event = dict(received.message_obj.raw_message)
        login = await adapter.bot.call_action("get_login_info")
        sent = await adapter.bot.call_action(
            "send_private_msg",
            user_id=int(raw_event["user_id"]),
            message=[
                {
                    "type": "text",
                    "data": {"text": "onebots-astrbot-interop-reply"},
                }
            ],
        )
        evidence = {
            "framework": "astrbot",
            "frameworkVersion": version("AstrBot"),
            "adapterVersion": version("aiocqhttp"),
            "event": {
                "postType": raw_event.get("post_type"),
                "messageType": raw_event.get("message_type"),
                "plainText": received.message_str,
                "messageId": received.message_obj.message_id,
            },
            "login": login,
            "send": sent,
        }
        temporary = EVIDENCE_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(evidence, ensure_ascii=False), encoding="utf-8")
        temporary.replace(EVIDENCE_FILE)
        await asyncio.Future()
    finally:
        await adapter.terminate()
        server.cancel()


if __name__ == "__main__":
    asyncio.run(main())
