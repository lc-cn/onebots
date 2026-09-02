import json
import os
from importlib.metadata import version
from pathlib import Path

import nonebot
from nonebot import on_message
from nonebot.adapters.onebot.v11 import Adapter, Bot, MessageEvent


HOST = "127.0.0.1"
PORT = int(os.environ["ONEBOTS_INTEROP_NONEBOT_PORT"])
TOKEN = os.environ["ONEBOTS_INTEROP_TOKEN"]
EVIDENCE_FILE = Path(os.environ["ONEBOTS_INTEROP_EVIDENCE"])

nonebot.init(
    driver="~fastapi",
    host=HOST,
    port=PORT,
    log_level="ERROR",
    onebot_access_token=TOKEN,
)
driver = nonebot.get_driver()
driver.register_adapter(Adapter)
message_matcher = on_message(priority=1, block=True)


@message_matcher.handle()
async def capture_message(bot: Bot, event: MessageEvent) -> None:
    login = await bot.call_api("get_login_info")
    sent = await bot.call_api(
        "send_private_msg",
        user_id=int(event.get_user_id()),
        message=[{"type": "text", "data": {"text": "onebots-nonebot-interop-reply"}}],
    )
    evidence = {
        "framework": "nonebot",
        "frameworkVersion": version("nonebot2"),
        "adapterVersion": version("nonebot-adapter-onebot"),
        "selfId": bot.self_id,
        "event": {
            "postType": event.post_type,
            "messageType": event.message_type,
            "userId": event.get_user_id(),
            "plainText": event.get_plaintext(),
            "messageId": event.message_id,
        },
        "login": login,
        "send": sent,
    }
    temporary = EVIDENCE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(evidence, ensure_ascii=False), encoding="utf-8")
    temporary.replace(EVIDENCE_FILE)


if __name__ == "__main__":
    nonebot.run(host=HOST, port=PORT)
