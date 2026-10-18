# Viessmann heat pump for TRMNL X

A read-only private TRMNL plugin. English is the default; select **Deutsch** in the plugin's **Display language** field for German. The selection applies to all four layouts, status messages, the chart description, decimal separators and timestamps. Configuration fields, documentation and developer tools use English.

## Repository and import format

The repository root contains the official flat plugin files:

```text
settings.yml
full.liquid
half_horizontal.liquid
half_vertical.liquid
quadrant.liquid
auxiliary/                 # Documentation, debugging and development tools
```

Only the five plugin files belong in the import ZIP, without a parent folder. Do not import a GitHub source ZIP: it includes a directory wrapper and auxiliary files. The plugin requires no local JavaScript or Python runtime; the tools in this folder are optional.

To package the existing plugin files using Python's standard library, run from the repository root:

```sh
python auxiliary/package.py
```

This creates and verifies `auxiliary/output/viessmann-trmnl-import.zip`. A different output path can be selected with `--output PATH`. In TRMNL, open **Plugins → Private Plugin → Import new** and select this ZIP. Developer features or a BYOD license are required for private plugins.

The plugin uses **Polling** with an hourly refresh interval (60 minutes). It starts without credentials or sample readings. Complete the API identifiers and OAuth configuration before the first successful refresh.

## Connect Viessmann directly

1. Import the plugin and open its settings.
2. Set **API installation ID**, **API gateway serial number** and **API device ID** from the API inventory below. These values are not OAuth credentials.
3. Under OAuth settings, enter your own Viessmann application's Client ID. For a public PKCE client, leave the Client Secret empty. Do not put tokens in the markup or Static Data.
4. Copy the exact **OAuth Redirect URL shown by your own TRMNL plugin** into the Viessmann application's allowed redirect URIs.
5. Verify the imported provider configuration against the current documentation for your Viessmann application:

| Setting | Value |
|---|---|
| Authorization URL | `https://iam.viessmann-climatesolutions.com/idp/v3/authorize` |
| Token / refresh URL | `https://iam.viessmann-climatesolutions.com/idp/v3/token` |
| Scopes | `IoT User offline_access` |
| PKCE | Enabled, S256 |
| Scope separator | Space |
| Token authentication | body |
| Token body format | form |
| Token field | access_token |
| Expiry field / strategy | expires_in / expireIn |

6. Connect through TRMNL and authorize in the Viessmann window. TRMNL stores and refreshes the tokens.
7. Save, then **Force Refresh**. In **Edit Markup / Your Variables**, verify the API response and compare the displayed values with ViCare.

The included settings use TRMNL's documented OAuth provider keys. Live authorization, automatic refresh and the device's actual feature availability still require verification with the account. A missing refresh token may indicate a scope or application-type mismatch.

## Optional API inventory helper

The supplied screenshot identifies an indoor unit as **IDU-A Modular AWMIW.A1.19-V051**, with ViCare device ID **1**. The default API device ID is a starting candidate; verify it against the API inventory. The indoor-unit serial shown in ViCare is not automatically the gateway serial.

The inventory request is:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/equipment/installations?includeGateways=true
Authorization: Bearer <access-token>
```

Use `data[].id`, `data[].gateways[].serial`, and `data[].gateways[].devices[].id`. Then request the selected device's features:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/features/installations/INSTALLATION/gateways/GATEWAY/devices/DEVICE/features/
Authorization: Bearer <access-token>
```

The optional helper prompts privately for an existing access token. It uses GET requests only, never prints or saves the token, and limits its output to device identifiers or relevant feature data:

```sh
python auxiliary/inspect_api.py
python auxiliary/inspect_api.py --installation INSTALLATION --gateway GATEWAY --device 1
```

Each request consumes API quota. The helper has no polling or automatic retry. On HTTP 401 reconnect, on 403 check API permissions, and on 429 wait for the limit to reset. Inventory output contains installation and gateway identifiers; redact them before sharing.

## Feature mapping

| Display | Default API feature | Property |
|---|---|---|
| Supply temperature | `heating.secondaryCircuit.sensors.temperature.supply` | `properties.value.value` |
| Hot-water cylinder | `heating.dhw.sensors.temperature.dhwCylinder` | `properties.value.value` |
| Outdoor temperature | `heating.sensors.temperature.outside` | `properties.value.value` |
| Curve slope / offset | `heating.circuits.N.heating.curve` | `properties.slope.value`, `properties.shift.value` |
| Operating mode | `heating.circuits.N.operating.modes.active` | `properties.value.value` |

These are candidates to verify for the device. The three temperature feature names and heating circuit are configurable. Circuit 0 is the first API circuit; additional circuits may be 1 or 2. The markup accepts a `data` feature array or `IDX_0.data` when wrapped by multi-URL polling.

The current hot-water feature name uses `dhwCylinder`; older instructions may reference `hotWaterStorage`, renamed by Viessmann in 2025. Missing, disabled or failed sensors display a dash rather than zero. Zero and negative readings are preserved. Unknown operating-mode codes are escaped and displayed unchanged. The operating mode does not indicate whether the compressor is currently running.

## Heating curve and data age

The full layout shows a **schematic**, using `20 + offset + slope × (20 − outdoor temperature)` across −20 to +20 °C outdoors, clipped to 20–60 °C on the vertical axis. It illustrates the parameters; it does not calculate Viessmann setpoints. Room setpoint, model-specific control, heating limits and maximum supply settings are not simulated. An exact curve requires a verified model formula or reference points. Compact layouts show temperatures without the chart.

The screenshot's 50 °C maximum supply setting is not a current sensor reading and is not used as one.

Timestamps use UTC, formatted according to the selected display language. Data is marked stale based on the oldest displayed API timestamp, by default after 120 minutes. Missing timestamps are identified explicitly. An E-Ink screen can retain its last image when offline: the stale badge cannot update itself until another screen is rendered. Always check the visible timestamp.

## Development, previews and tests

All development files live here; the root `full.liquid` and `settings.yml` are the source plugin files. Build regenerates the three compact layouts from `full.liquid`, along with local preview files in ignored `auxiliary/output/`.

From the repository root:

```sh
npm --prefix auxiliary ci
npm --prefix auxiliary run build
npm --prefix auxiliary test
python auxiliary/package.py
```

Open `auxiliary/output/preview.html` locally. Its plugin-language selector demonstrates English and German with sample data or without a connection. All surrounding preview controls use English. `auxiliary/output/demo-data.json` is a synthetic API fixture; it is not shipped as live data. To preview in TRMNL, temporarily use Static strategy with this fixture, then restore Polling before live use.

Tests cover all layouts and both languages, English fallback, status messages, localized numbers and dates, missing/disabled/failed sensors, zero/negative values, stale/missing timestamps, custom mappings and safe HTML escaping. Packaging validates the exact flat file list and template size limit. Physical TRMNL X rendering and live OAuth/API behavior have not been verified.

## Official references

- [TRMNL private-plugin ZIP format](https://help.trmnl.com/en/articles/10542599-importing-and-exporting-private-plugins)
- [TRMNL custom fields and select options](https://help.trmnl.com/en/articles/10513740-custom-plugin-form-builder)
- [TRMNL polling and Liquid](https://help.trmnl.com/en/articles/9510536-private-plugins)
- [TRMNL OAuth settings](https://trmnl.com/integrations/private_plugin)
- [TRMNL OAuth YAML keys and PKCE](https://github.com/usetrmnl/trmnlp#oauth2)
- [Viessmann feature renaming](https://developer.viessmann-climatesolutions.com/start/news/important-updates-to-viessmann-api-effective-30-04-2025.html)
- [Viessmann developer portal](https://developer.viessmann-climatesolutions.com/start.html)

Endpoint implementation references: [PyViCare OAuth manager](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareAbstractOAuthManager.py) and [feature service](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareService.py).
