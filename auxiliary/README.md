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
transform.js               # Serverless response reduction
auxiliary/                 # Documentation, debugging and development tools
```

Only the six plugin files belong in the import ZIP, without a parent folder. The flat archive includes `transform.js`, following the official CLI's Serverless transform-file support. Do not import a GitHub source ZIP: it includes a directory wrapper and auxiliary files. The plugin requires no local JavaScript or Python runtime; the tools in this folder are optional.

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

Verify **Enable PKCE? → Yes** after saving. A **code challenge required** error means a new authorization request must be started with PKCE enabled.

## Serverless response reduction

Viessmann's full feature response can exceed TRMNL's 100 KB polling limit. `transform.js` defines the documented `run(input)` entry point for the Node Serverless runtime. It selects temperature readings, target settings, the selected circuit's curve, operating mode, active heating program and supply-temperature limits, then keeps only their required properties, enabled state and timestamps. It also returns only the runtime settings needed by the markup; credentials, commands and previous output are not echoed. No extra network requests are made.

`settings.yml` enables `serverless_language: node`; the packager includes the script. For an existing connected plugin, follow the [upgrade instructions](../README.md#upgrade-an-existing-plugin-for-large-api-responses): paste the script into **Edit Markup → Serverless**, select **Node**, save, reset the impaired status, then force a refresh. Verify the script is present in that tab after new imports too.

The [Serverless guide](https://help.trmnl.com/en/articles/14130649-serverless) describes the UI and function contract. The [official CLI](https://github.com/usetrmnl/trmnlp#serverless-transforms) documents `transform.js` upload support.

The included settings use TRMNL's documented OAuth provider keys. Live authorization, automatic refresh and the device's actual feature availability still require verification with the account. A missing refresh token may indicate a scope or application-type mismatch.

## Optional API inventory helper

The supplied screenshot identifies an indoor unit as **IDU-A Modular AWMIW.A1.19-V051**, with ViCare device ID **1**. The subsequently supplied API inventory identifies the heating device as **`0`**, model `E3_Vitocal_17`, with a Vitocal 250-A role. The API ID is the one used by this plugin and is now the default. The indoor-unit serial shown in ViCare is not automatically the gateway serial.

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
python auxiliary/inspect_api.py --installation INSTALLATION --gateway GATEWAY --device 0
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

## Electrical and thermal API mapping

The serverless script reads these feature candidates directly from the polled response. It returns only normalized values, source scope and timestamps, without copying commands or full energy histories into the render payload.

| Reading | Preferred / fallback features | Property |
|---|---|---|
| Current electricity | `heating.power.consumption.current`, then `heating.compressors.0.power.consumption.current` | `properties.value`, W/kW |
| Current heat output | `heating.heat.production.current`, then `heating.compressors.0.heat.production.current` | `properties.value`, W/kW |
| Daily electricity total | `heating.power.consumption.summary.total`, `.total`, `.summary` | `properties.currentDay` or newest `properties.day.value[0]`, Wh/kWh |
| Daily heat total | `heating.heat.production.summary.total`, `.total`, `.summary` | Same day properties, Wh/kWh |
| Electricity component fallback | `heating.power.consumption.summary.heating` + `.summary.dhw`, plus `.summary.cooling` if present | `properties.currentDay`; legacy `consumption.heating/dhw/cooling` day arrays also supported |
| Heat component fallback | `heating.heat.production.summary.heating` + `.summary.dhw` | `properties.currentDay`; legacy `production.heating/dhw` day arrays also supported |

Shortened feature names in this table retain their family's full prefix. These are supported candidates, not a claim that the account exposes all of them. Optional `current_power_feature`, `daily_energy_feature`, `current_heat_feature` and `daily_heat_feature` settings select explicit features. Electrical overrides must remain in the `.power.consumption.` family and thermal overrides in `.heat.production.`. Compressor or auxiliary-heater overrides are labelled as components. A scalar daily feature ending in `.day` is also supported through `properties.value`.

Totals are preferred over components to avoid double counting. Missing heating/DHW components are not silently substituted with zero; an electrical cooling component that exists but is unusable prevents an incomplete sum. Cooling is excluded from the heating/DHW heat fallback. Each daily counter must have a valid feature timestamp on the same local date as the current render; yesterday and unknown dates are withheld. A same-day old timestamp may still show a value with its own stale warning.

The API owns the day bucket and its reset; the script does not maintain an accumulator or derive kWh from instantaneous kW. Display-zone changes do not repartition the API's counters. Set `time_zone` to the installation's zone for day validation. W/kW and Wh/kWh are normalized explicitly; unknown units, negative values and disabled/error features are unavailable. Actual zero values are preserved.

[PyViCare's heat-pump implementation](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareHeatPump.py) documents the compressor input/output readings and electrical daily summaries. The optional inventory helper now includes both `.power.consumption.` and `.heat.production.` feature families. The available features and actual hosted readings still need verification in the connected account.

## Heating curve and data age

The full layout calculates the six values at −30, −20, −10, 0, 10 and 20 °C, with intermediate points for the complete graph. It uses the E3 variant implemented in [PyViCare's heat-curve calculation](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareHeatCurveCalculation.py). [PyViCare selects this variant](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareHeatingDevice.py) for devices with both `type:heatpump` and `type:E3`, matching the supplied inventory.

For outdoor temperature `x`, room target `t`, slope `s`, offset `n`, and `d = x − t`:

```text
unlimited supply = t + n − s × d × (1.4347 + 0.021 × d + 0.0002479 × d²)
```

The configured API minimum and maximum from `heating.circuits.N.temperature.levels` are then applied independently. This produces the nonlinear shape and the upper plateau. Command constraints are never used as the configured limit. If the API maximum is missing, the optional `max_supply_temperature` field can provide it; the chart identifies whether its maximum came from the API or configuration. Otherwise it explicitly says the limit is unavailable.

Room target is read from `heating.circuits.N.operating.programs.active` and the corresponding `operating.programs.PROGRAM.properties.temperature.value`. Plotting can fall back to the normal/normalHeating program. If neither is available, no room temperature is invented and the curve is omitted. A direct supply-target feature can be configured with `supply_setpoint_feature`; otherwise a target is calculated from this model and labelled as such. The main configured hot-water target comes from `water_setpoint_feature`, defaulting to `heating.dhw.temperature.main`; it is not a determination of the active DHW schedule.

These are calculated curve values from live settings, not a verified direct export of ViCare's curve points. They do not simulate compressor behavior, room-feedback corrections or dampened outdoor readings. Compare with the app for the device/firmware. For exact known reference values, `curve_points` optionally accepts 2–41 JSON objects with numeric `outdoor` and `supply` values; these points replace the model and are labelled **Reference points**. Leave blank for dynamic calculation. Invalid references are flagged rather than presented as exact data.

Freshness uses only valid supply, hot-water and outdoor sensor timestamps, ignoring curve, operating-mode and target-setting timestamps. This fixes false stale warnings caused by unchanged configuration. The default threshold remains 120 minutes. Sensor timestamps may themselves represent last changes rather than regular measurements, so their age does not prove an outage.

Timestamps are formatted in the configured `time_zone`, defaulting to `Europe/Berlin`. Standard IANA zones and daylight-saving transitions are handled using `Intl.DateTimeFormat`; invalid zones fall back to UTC. Staleness always compares absolute timestamps and is unaffected by the display zone. An offline E-Ink screen cannot update its timestamp or stale badge until a new screen is rendered.

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

Tests cover all layouts and both languages, English fallback, status messages, localized numbers and dates, time zones and DST transitions, nonlinear curves and temperature caps, electrical/thermal units and source separation, day-counter rollover and totals, missing/disabled/failed sensors, zero/negative values, stale/missing timestamps, custom mappings and safe HTML escaping. Transform tests cover oversized inputs, small outputs, configuration preservation and removal of commands and credentials. Packaging validates the exact flat file list and template size limit. Physical TRMNL X rendering and hosted Serverless behavior have not been verified; the user has confirmed successful OAuth authorization with PKCE enabled.

## Official references

- [TRMNL private-plugin ZIP format](https://help.trmnl.com/en/articles/10542599-importing-and-exporting-private-plugins)
- [TRMNL custom fields and select options](https://help.trmnl.com/en/articles/10513740-custom-plugin-form-builder)
- [TRMNL polling and Liquid](https://help.trmnl.com/en/articles/9510536-private-plugins)
- [TRMNL OAuth settings](https://trmnl.com/integrations/private_plugin)
- [TRMNL OAuth YAML keys and PKCE](https://github.com/usetrmnl/trmnlp#oauth2)
- [Viessmann feature renaming](https://developer.viessmann-climatesolutions.com/start/news/important-updates-to-viessmann-api-effective-30-04-2025.html)
- [Viessmann developer portal](https://developer.viessmann-climatesolutions.com/start.html)

Endpoint implementation references: [PyViCare OAuth manager](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareAbstractOAuthManager.py) and [feature service](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareService.py).
