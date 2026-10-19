# Detailed instructions

Use the [main README](../README.md) for requirements, initial setup, required parameters, and everyday use.

| Guide | Contents |
|---|---|
| [Configuration](configuration.md) | Every custom field, provider settings, and feature overrides. |
| [Development](development.md) | Repository structure, local preview, tests, and deployment. |
| [Troubleshooting](troubleshooting.md) | Authentication, missing or delayed readings, and the debugging scripts. |
| [API reference](api-reference.md) | Temperature sources, activity detection, component status, curve calculation, and time formatting. |
| [Energy fields](api-energy-fields.md) | Electricity and heat source selection, units, daily totals, yesterday comparisons, and read-time markers. |

The Python scripts in this directory are optional diagnostic tools. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and run their commands from the repository root with `uv run --script auxiliary/SCRIPT.py`. Each script declares its Python version and dependencies inline; uv manages them automatically. Start with the [Client ID and device-ID discovery instructions](troubleshooting.md#find-installation-gateway-and-device-ids). They are not part of the published plugin.
