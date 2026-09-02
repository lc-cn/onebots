# Solutions

Each framework page provides an API compatibility boundary, generated configurations for both sides, and command-level troubleshooting.

```bash
onebots frameworks
onebots frameworks --framework <framework> --account <platform.account_id>
onebots -r <adapter> -p <protocol> -t <framework> -c config.yaml
onebots doctor -c config.yaml
```

`-t` only loads compatibility behavior. Protocol configuration remains the sole authority that enables transports.

Use the [framework matrix](/en/solution/frameworks) and [troubleshooting guide](/en/solution/troubleshooting).
