# Configuration reference

The plugin definition is [src/settings.yml](../src/settings.yml). Enter installation-specific values in the TRMNL plugin settings. The Serverless transform reads custom fields from `trmnl.plugin_settings.custom_fields_values`.

## Required custom fields

| Key | Default | Meaning |
|---|---|---|
| `installation_id` | None | API installation ID. |
| `gateway_serial` | None | API gateway serial. |
| `device_id` | `0` | API heating-device ID. This is a required field with a default, not an instruction to use `0` on every installation. |

Follow [API parameter discovery](troubleshooting.md#find-installation-gateway-and-device-ids) to obtain the Client ID, register redirect URLs, and find the three device identifiers with the inventory helper. Do not substitute the Client ID, indoor-unit serial, or a device number displayed by ViCare.

## Display and circuit settings

| Key | Default | Effect |
|---|---|---|
| `language` | `en` | `en` for English or `de` for German labels and decimal separators. |
| `time_zone` | `Europe/Berlin` | IANA time zone for local timestamps, regional date formatting, and daily-counter date validation. Invalid zones fall back to UTC. |
| `circuit` | `0` | Selects `heating.circuits.N` for the displayed radiator-circuit supply, target, heating curve, room program, and circulation status. |
| `stale_minutes` | `120` | Visible age-marker threshold for explicit `dayValueReadAt` timestamps. Missing read times and general feature timestamps do not create a marker. |

The plugin refresh interval is configured separately in `settings.yml` as `refresh_interval: 15`, in minutes.

## Temperature feature overrides

Defaults are sufficient when the device exposes the expected features. Use an override only after checking the feature inventory.

| Key | Default | Effect |
|---|---|---|
| `water_feature` | `heating.dhw.sensors.temperature.dhwCylinder` | Displayed hot-water cylinder reading. |
| `outside_feature` | `heating.sensors.temperature.outside` | Displayed outdoor reading and the heating-curve marker's outdoor coordinate. |
| `water_setpoint_feature` | `heating.dhw.temperature.main` | Displayed hot-water target. This is the configured main target, not necessarily a scheduled second temperature. |
| `supply_feature` | `auto` | Supply source used in diagnostic sensor models and freshness metadata. Automatic selection prefers the selected circuit sensor, then the heat-pump secondary-circuit sensor. A feature name selects that diagnostic source explicitly. |
| `supply_setpoint_feature` | Blank | Optional direct target for the diagnostic `setpoints.supply` model. Without an override, that model uses the circuit target, then the calculated curve target when possible. |

For diagnostic supply selection, both `auto` and `heating.secondaryCircuit.sensors.temperature.supply` enable automatic circuit-first selection.

The **displayed circuit supply, displayed supply target, and graph target marker** always use `heating.circuits.N.sensors.temperature.supply` and `heating.circuits.N.temperature`. The two diagnostic supply overrides do not change these displayed readings. A missing circuit reading shows a dash; heat-pump readings and calculated targets do not replace it.

## Heating-curve settings

| Key | Default | Effect |
|---|---|---|
| `max_supply_temperature` | Blank | Maximum supply temperature in °C, used only when the API omits the circuit maximum. The form accepts 0–100. Use the device's actual configured limit. |
| `curve_points` | Blank | Optional reference points replacing the calculated curve. Supply 2–41 objects with unique numeric `outdoor` values and numeric `supply` values. |

Example reference points:

```json
[{"outdoor": -30, "supply": 50}, {"outdoor": 0, "supply": 35}, {"outdoor": 20, "supply": 25}]
```

These are illustrative values, not recommended settings for a heat pump. Leave the field blank to calculate the curve from the live parameters. The plugin sorts valid reference points by outdoor temperature and flags invalid input. See [curve calculation](api-reference.md#heating-curve) for the model and limits.

## Energy feature overrides

| Key | Default selection |
|---|---|
| `current_power_feature` | Whole-device electrical power, then compressor 0. |
| `daily_energy_feature` | Device electricity total, then heating + hot water, including cooling when present and usable. |
| `current_heat_feature` | Whole-device thermal output, then compressor 0. |
| `daily_heat_feature` | Device heat total, then heating + hot water. |

Blank means automatic selection. A configured override selects that feature without silently falling back to another feature if it is unavailable. Electrical overrides must belong to the `.power.consumption.` family; thermal overrides must belong to `.heat.production.`. Current readings require W/kW units; daily readings require Wh/kWh units and a feature timestamp from the current local day.

The selected scope can be a device, compressor, auxiliary heater, or a particular use. A component override is not a whole-device measurement. See [energy fields](api-energy-fields.md) for exact candidates, sums, and yesterday's comparison.

## OAuth provider settings

The plugin definition supplies these settings. The user must provide the Viessmann Client ID and register the redirect URL displayed by TRMNL in the Viessmann application.

| Setting | Value |
|---|---|
| Authorization URL | `https://iam.viessmann-climatesolutions.com/idp/v3/authorize` |
| Token URL | `https://iam.viessmann-climatesolutions.com/idp/v3/token` |
| Scopes | `IoT User offline_access` |
| PKCE | Enabled, S256 |
| Token request authentication | Body / form |
| Client Secret | Empty for the standard public PKCE client |

TRMNL stores the OAuth connection and tokens. The hosted YAML values are `oauth_enabled: "true"` and `oauth_pkce_enabled: "yes"`; these settings use different string encodings. The polling header is `Authorization=Bearer {{ oauth_access_token }}`.

The configured polling request is:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/features/installations/INSTALLATION/gateways/GATEWAY/devices/DEVICE/features/
```

OAuth's `/idp/v3` and the IoT API's `/iot/v2` are separate versioned interfaces.
