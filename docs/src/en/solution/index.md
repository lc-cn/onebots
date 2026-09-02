# Solutions

Solutions describe how OneBots works with downstream systems. Platform documentation answers where messages come from, protocol documentation explains how they are exposed, and solutions identify who consumes those protocols and how to build a verified workflow.

## Bot framework Applications

The [framework runtime](/en/solution/frameworks) covers 25 activatable targets. Activate a framework with `onebots -t <framework>`; its Application is applied to every protocol instance and contributes compatible actions, dedicated routes, connection methods, and capability descriptions per protocol.

Every framework now has its own page. `available` pages provide pinned configuration or interoperability evidence, `experimental` pages provide executable connection templates with explicit unverified boundaries, and `legacy` pages serve existing migrations. All three stages can be activated with `-t` and remain visible in the management API.
