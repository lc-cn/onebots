import json
import os
from importlib.metadata import version
from pathlib import Path

from melobot import Bot, PluginPlanner
from melobot.protocols.onebot.v11 import Adapter, MessageEvent, OneBotV11Protocol, WSClient, on_message


@on_message()
async def capture(event: MessageEvent, adapter: Adapter) -> None:
    login = await (await adapter.get_login_info()).unwrap(0)
    sent = await (await adapter.send("onebots-melobot-interop-reply")).unwrap(0)
    evidence = {
        "framework": "melobot",
        "frameworkVersion": version("melobot"),
        "event": {
            "message_type": event.message_type,
            "message_id": event.message_id,
            "raw_message": event.raw_message,
        },
        "login": login.result(),
        "send": sent.result(),
    }
    path = Path(os.environ["ONEBOTS_INTEROP_EVIDENCE"])
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(evidence), encoding="utf-8")
    temporary.replace(path)


plugin = PluginPlanner(version="1.0.0", flows=[capture])
bot = Bot("onebots-interop")
bot.add_protocol(
    OneBotV11Protocol(
        WSClient(
            os.environ["ONEBOTS_INTEROP_ENDPOINT"],
            retry_delay=0.1,
            access_token=os.environ["ONEBOTS_INTEROP_TOKEN"],
        )
    )
)
bot.load_plugin(plugin)
bot.run()
