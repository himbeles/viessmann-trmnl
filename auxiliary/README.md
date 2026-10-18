# Viessmann API and implementation notes

The plugin is a standard [trmnlp project](https://github.com/usetrmnl/trmnlp). Use the [root README](../README.md) for setup, native previews, tests and GitHub publishing. This folder contains optional API debugging tools and detailed feature documentation.

## Live polling diagnostics

The official CLI handles publishing. The small Python helper here checks the saved public OAuth toggles, resets health and requests a real poll of existing plugin **510867**. It requires a TRMNL account API key in `TRMNL_API_KEY`; it never rewrites OAuth settings or prints credentials, identifiers or raw response bodies.

```sh
python3 auxiliary/refresh.py
```

Set the key privately in your shell, or run the check in GitHub's existing deployment job. The helper uses Python's standard library. An optional `--debug` enables TRMNL's own request logs for 24 hours; inspect those privately in TRMNL. The API may summarize arrays as `{_compacted, count, sample}`; this is an API inspection format, not missing dashboard data.

The root workflow comes from `trmnlp init`. Its only plugin-specific extension is this live polling check after the official `trmnlp push --force` command. No custom clone/merge/deploy pipeline or npm dependencies are needed.

The local `.trmnlp.yml` supplies synthetic input using native variable overrides. Tests in `tests/plugin_spec.rb` use the same fixture with native `trmnl.transform`, `trmnl.render`, a frozen clock and the official Liquid runtime. Shared styling and translations are in `src/shared.liquid`; all four view files use TRMNL's native `template`/`render` tags. The transform is unchanged by the architecture migration.

The single ignored lint rule, `no_style_restyling_framework`, preserves the existing dashboard's custom typography. Other checks remain enabled.

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

## Official references

- [TRMNL private-plugin ZIP format](https://help.trmnl.com/en/articles/10542599-importing-and-exporting-private-plugins)
- [TRMNL custom fields and select options](https://help.trmnl.com/en/articles/10513740-custom-plugin-form-builder)
- [TRMNL polling and Liquid](https://help.trmnl.com/en/articles/9510536-private-plugins)
- [TRMNL OAuth settings](https://trmnl.com/integrations/private_plugin)
- [TRMNL OAuth YAML keys and PKCE](https://github.com/usetrmnl/trmnlp#oauth2)
- [Viessmann feature renaming](https://developer.viessmann-climatesolutions.com/start/news/important-updates-to-viessmann-api-effective-30-04-2025.html)
- [Viessmann developer portal](https://developer.viessmann-climatesolutions.com/start.html)

Endpoint implementation references: [PyViCare OAuth manager](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareAbstractOAuthManager.py) and [feature service](https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareService.py).
