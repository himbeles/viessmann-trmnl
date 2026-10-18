# Viessmann device-wide energy fields

Checked against the public documentation on 2026-10-18.

## Official data-point catalogue

Source: [Viessmann data-point catalogue](https://api.viessmann-climatesolutions.com/documentation/data-points). The page loads its catalogue in the client; its initial HTML includes the feature names, descriptions and access-group labels.

| Feature | Documented purpose | Catalogue access-group label |
|---|---|---|
| `heating.heat.production.total` | Statistics for total generated heat energy | Advanced Feature Data |
| `heating.heat.production.current` | Current system heat generation (power, not cumulative energy) | Advanced and Basic Feature Data |
| `heating.heat.production.summary.heating` | Cumulative heat statistics for space heating | Basic Feature Data |
| `heating.heat.production.summary.dhw` | Cumulative heat statistics for domestic hot water | Basic Feature Data |
| `heating.heat.production.summary.cooling` | Cumulative cooling statistics | Basic Feature Data |
| `heating.power.consumption.total` | Electricity-consumption statistics in kWh | Basic Feature Data |

The correct named candidate for a device-wide heat-energy total is **`heating.heat.production.total`**. The access-group label is not proof of a particular account's entitlement, nor a statement that a purchasable package currently exists. Feature availability also depends on the device/controller. The public [pricing page](https://developer.viessmann-climatesolutions.com/start/pricing.html) explicitly distinguishes catalogue coverage from device/plan availability.

The catalogue does not list `heating.heat.production.summary.total` or a bare `heating.heat.production.summary` as individual total-energy features. The plugin retains these names as compatibility aliases after the documented `.total` field; they must not be presented as verified API field names.

## Vitocal 250-A response evidence

Source: [PyViCare's anonymized Vitocal250A response](https://github.com/openviess/PyViCare/blob/588a107b78f61c8982e43439c91b268acfdd02a9/tests/response/Vitocal250A.json#L5010).

This captured response has enabled `heating.heat.production.summary.heating` and `.summary.dhw` fields. Both expose `properties.currentDay.value` with `unit: kilowattHour`, alongside longer-period summaries. It also has a cooling summary. It does not contain `heating.heat.production.total`.

Its electrical `heating.power.consumption.total` field instead contains `properties.day.value`, an array of daily kWh values, and `dayValueReadAt`. That electrical feature must not be mistaken for thermal production.

This is evidence for one captured device response, not a live inventory of the user's installation. It supports the plugin's heating-plus-DHW fallback when a valid device-wide thermal counter is unavailable. Actual availability for another device/account must be verified from its own `/features/` response.

## Plugin selection and display

- Automatic daily-total selection checks the documented `.total` first, then compatibility aliases, then heating/DHW components.
- `daily_heat_feature` explicitly selects one feature when configured. An unavailable override is not silently replaced with another source.
- Counters require recognized energy units and a timestamp from the current local day. Missing or unsupported values remain unavailable.
- The combined heat value adds heating and DHW only, not cooling. Each component retains its own timestamp and stale flag.
- Displayed timestamps omit CET/CEST/MEZ/MESZ/UTC indicators while retaining configured-zone conversion and daylight-saving handling.
