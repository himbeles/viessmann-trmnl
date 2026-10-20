# Viessmann heat pump for TRMNL

A read-only dashboard for a ViCare-connected heat pump, designed for TRMNL X and available in all four TRMNL layouts. It shows heating and hot-water temperatures, a heating curve, component status, electrical consumption, and heat output. English is the default; German is available.

## Requirements

- A TRMNL account with access to private plugins, and a TRMNL device or BYOD display.
- A heat pump connected to your ViCare account.
- A [Viessmann developer application](https://developer.viessmann-climatesolutions.com/start.html) for OAuth authentication.
- [trmnlp](https://github.com/usetrmnl/trmnlp#readme) to publish the plugin, or the configured GitHub Actions workflow to update it.

Available readings depend on the heat pump and the API access granted to your account.

## Required parameters

| Parameter | Where to enter it | What to use |
|---|---|---|
| Viessmann Client ID | TRMNL OAuth settings | The Client ID of your Viessmann developer application. |
| OAuth Redirect URL | Viessmann developer application | Register the exact redirect URL shown in the TRMNL plugin's OAuth settings. |
| `installation_id` | Plugin custom fields | Your installation's API ID. |
| `gateway_serial` | Plugin custom fields | The gateway serial returned by the API. |
| `device_id` | Plugin custom fields | The heating device's API ID. The default is `0`; verify it against the device list. |

The installation, gateway, and device IDs are different from the Client ID. A ViCare screen's device number or product serial is not necessarily an API identifier. Use the [API inventory instructions](auxiliary/troubleshooting.md#find-installation-gateway-and-device-ids) to find the correct values.

The standard setup uses a public OAuth client with PKCE and an empty Client Secret. TRMNL manages the access and refresh tokens; you do not enter tokens in the plugin's custom fields.

## Find your API parameters

1. Sign in to the [Viessmann Developer Portal](https://app.developer.viessmann-climatesolutions.com/) with the same account you use for ViCare. Open **My Dashboard → Your clients**, create or edit a public client, and copy its **Client ID**.
2. Register the exact **OAuth Redirect URL** shown in your TRMNL plugin settings. Also add **`http://localhost:51125`** (no trailing slash) for the local discovery helper; keep the TRMNL redirect registered.
3. Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then run this from the cloned repository on a computer with a browser:

   ```sh
   uv run --script auxiliary/inspect_api.py --client-id YOUR_CLIENT_ID
   ```

   Sign in to Viessmann in the browser. `uv` installs the Python version and dependencies declared in the script; no separate `pip install` is needed.
4. In the printed inventory, find your heating device. Copy the containing installation's `id` to `installation_id`, its gateway's `serial` to `gateway_serial`, and the device's `id` to `device_id`. Enter your Client ID separately in TRMNL's OAuth settings.

See the [detailed discovery guide](auxiliary/troubleshooting.md#find-installation-gateway-and-device-ids) for an output example, token-based access, and feature inspection.

## Setup

1. Clone this repository and install [trmnlp](https://github.com/usetrmnl/trmnlp#readme).
2. Set the target plugin in `src/settings.yml`. This repository targets plugin **510867**. Keep that ID when updating that instance. For a new private plugin, follow the [publishing instructions](auxiliary/development.md#publish-to-an-instance) to set up a separate target.
3. From the repository directory, publish the plugin:

   ```sh
   trmnlp login
   trmnlp push
   ```

4. Open the plugin's settings in TRMNL and enter the required installation, gateway, and device IDs.
5. Enter your Viessmann Client ID in the OAuth settings. Register TRMNL's redirect URL in your Viessmann application, enable **OAuth Authentication** and **PKCE**, and authorize your ViCare account. The plugin definition supplies the provider URLs and scopes.
6. Save and use **Force Refresh** to check the readings. Add the plugin to your device playlist and choose a layout.

The default refresh interval is **15 minutes**. Data processing runs in TRMNL Serverless; no separate server is required.

## Basic settings

All of these are optional:

| Setting | Default | When to change it |
|---|---|---|
| Display language (`language`) | English (`en`) | Select German (`de`) for German labels and number formatting. |
| Display time zone (`time_zone`) | `Europe/Berlin` | Set the installation's IANA time zone for timestamps and daily-counter date checks. |
| Heating circuit (`circuit`) | `0` | Select the circuit that supplies your radiators or underfloor heating. |
| Daily-counter read-time warning (`stale_minutes`) | `120` minutes | Set when an explicit `dayValueReadAt` timestamp should produce a clock and read-date marker. |

Leave API feature overrides and curve reference points at their defaults unless your device requires them. The [complete configuration reference](auxiliary/configuration.md) explains every field and its effect.

## Reading the dashboard

- **Heating:** outdoor temperature, room target, pressure, heating curve, actual circuit supply and its target, and daily heating energy.
- **Hot water:** cylinder temperature, target, and daily hot-water energy.
- **Power / Leistung:** current electricity consumption and heat output in **kW**, plus compressor, electric auxiliary heater, and fan status.
- **Usage today / Verbrauch heute:** daily electricity consumption and heat output in **kWh**. A seven-day electricity chart sits to the left of today's large value. Completed days are black; today's running total is gray. Missing history leaves gaps.

The badge identifies heating, hot water, off, or unknown activity. A thicker border marks the active heating or hot-water block. A dash means the relevant reading or status is unavailable.

A gray clock and **As of / Stand** date appear only for stale explicit `dayValueReadAt` fields. The footer shows the newest displayed data timestamp; it does not mean every value updated then. Viessmann's API can update different readings independently and can differ from ViCare.

## Updating the plugin

For a manual update, run `trmnlp push` with the existing plugin ID. The existing instance retains its configured device IDs and OAuth connection.

For automatic updates, confirm the [publishing target](auxiliary/development.md#publish-to-an-instance), add your TRMNL account API key as the repository Actions secret **`TRMNL_API_KEY`**, then push to `main`. The workflow checks the plugin, publishes it to the configured instance, and verifies live polling. This key is for publishing and verification; it is not a Viessmann credential. Do not commit API keys or OAuth tokens.

## Further instructions

- [Local preview, testing, and publishing](auxiliary/development.md)
- [Complete configuration and OAuth settings](auxiliary/configuration.md)
- [Troubleshooting and API debugging tools](auxiliary/troubleshooting.md)
- [Sensor, status, and curve mappings](auxiliary/api-reference.md)
- [Electricity and heat counter selection](auxiliary/api-energy-fields.md)
