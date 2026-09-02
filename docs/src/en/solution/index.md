# Solutions

Solutions describe how OneBots works with downstream systems. Platform documentation answers where messages come from, protocol documentation explains how they are exposed, and solutions identify who consumes those protocols and how to build a verified workflow.

## Bot frameworks

The [bot framework solution](/en/solution/frameworks) covers downstreams such as Koishi, NoneBot, Karin, Zhin, AlemonJS, AstrBot, LangBot, AliceBot, Kovi, and Kotori. Every plan-ready solution is supplied by a Framework Integration Provider:

- a profile with versions, protocol, transport, verification level, and limitations;
- endpoint resolution for the framework's actual connection shape;
- redacted configuration templates with shared authentication;
- pinned evidence recording the gate command and passed checks.

A provider can be built in or registered dynamically by an extension package. It does not connect an IM platform or implement a protocol endpoint; it packages one downstream framework compatibility and deployment solution.
