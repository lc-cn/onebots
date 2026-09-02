import asyncio
import json
import os
from importlib.metadata import version
from pathlib import Path
import langbot_plugin.api.definition.abstract.platform.event_logger as abstract_logger
import langbot_plugin.api.entities.builtin.platform.events as platform_events
from langbot.pkg.platform.sources.aiocqhttp import AiocqhttpAdapter


HOST = "127.0.0.1"
PORT = int(os.environ["ONEBOTS_INTEROP_FRAMEWORK_PORT"])
TOKEN = os.environ["ONEBOTS_INTEROP_TOKEN"]
EVIDENCE_FILE = Path(os.environ["ONEBOTS_INTEROP_EVIDENCE"])


class FixtureLogger(abstract_logger.AbstractEventLogger):
    async def info(self, text: str, images=None, message_session_id=None, no_throw=True):
        return None

    async def debug(self, text: str, images=None, message_session_id=None, no_throw=True):
        return None

    async def warning(self, text: str, images=None, message_session_id=None, no_throw=True):
        return None

    async def error(self, text: str, images=None, message_session_id=None, no_throw=True):
        return None


adapter = AiocqhttpAdapter(
    config={"host": HOST, "port": PORT, "access-token": TOKEN},
    logger=FixtureLogger(),
)


async def capture(event: platform_events.FriendMessage, current: AiocqhttpAdapter) -> None:
    raw_event = dict(event.source_platform_object)
    login = await current.bot.call_action("get_login_info")
    sent = await current.bot.call_action(
        "send_private_msg",
        user_id=int(raw_event["user_id"]),
        message=[
            {
                "type": "text",
                "data": {"text": "onebots-langbot-interop-reply"},
            }
        ],
    )
    evidence = {
        "framework": "langbot",
        "frameworkVersion": version("langbot"),
        "adapterVersion": "built-in",
        "event": {
            "postType": raw_event.get("post_type"),
            "messageType": raw_event.get("message_type"),
            "plainText": raw_event.get("raw_message"),
            "messageId": raw_event.get("message_id"),
        },
        "login": login,
        "send": sent,
    }
    temporary = EVIDENCE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(evidence, ensure_ascii=False), encoding="utf-8")
    temporary.replace(EVIDENCE_FILE)


adapter.register_listener(platform_events.FriendMessage, capture)


if __name__ == "__main__":
    asyncio.run(adapter.run_async())
