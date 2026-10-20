# Electricity and heat counters

Electrical input and thermal output are independent quantities. The plugin reads each from the API; it does not infer heat from electricity or COP and does not integrate occasional kW samples to estimate daily kWh.

## Source selection

| Reading | Automatic selection | Property and units |
|---|---|---|
| Current electricity | `heating.power.consumption.current`, then `heating.compressors.0.power.consumption.current` | `properties.value`, W/kW |
| Current heat output | `heating.heat.production.current`, then `heating.compressors.0.heat.production.current` | `properties.value`, W/kW |
| Daily electricity | `heating.power.consumption.total`, then `.summary.total`, then `.summary` in the same family | `properties.currentDay`, or `properties.day.value[0]`, Wh/kWh |
| Daily heat | `heating.heat.production.total`, then `.summary.total`, then `.summary` in the same family | Same daily properties, Wh/kWh |
| Electricity sum | Heating + hot water, plus cooling when that use is exposed and enabled | See use counters below. |
| Heat sum | Heating + hot water | See use counters below. |

`.summary.total` and `.summary` are supported aliases; they are not separately documented device-wide heat features in the [Viessmann catalogue](https://api.viessmann-climatesolutions.com/documentation/data-points). The named device-wide heat counter is `heating.heat.production.total`. Catalogue groups do not guarantee availability for a particular device or account; consult the actual feature response and [API access information](https://developer.viessmann-climatesolutions.com/start/pricing.html).

For each use, selection prefers `heating.FAMILY.summary.USE`, then `heating.FAMILY.USE`, where:

- `FAMILY` is `power.consumption` or `heat.production`.
- `USE` is `heating`, `dhw`, or, for the electrical sum, `cooling`.

Each use block reads its own electricity and heat counters even when a separate device total is available. Missing use data is not allocated from a total.

Explicit `current_power_feature`, `daily_energy_feature`, `current_heat_feature`, and `daily_heat_feature` overrides select only their configured source. Unsupported or missing overrides are not silently replaced. A scalar daily feature ending in `.day` can supply its counter through `properties.value`.

## Units and totals

The transform normalizes W to kW and Wh to kWh, including the API's spelled-out unit names. Unsupported units and negative values are unavailable; actual zero is retained.

Device totals are used as reported and are not added to their components. A fallback sum requires valid heating and hot-water counters. If an enabled electrical cooling counter is exposed, that counter must also be usable for a complete electrical sum. Cooling is excluded from the heating/hot-water thermal fallback.

Current power can represent the whole device or only compressor 0. The source subtitle identifies this scope. A compressor-only reading excludes other electrical consumers or heat sources.

The daily heat subtitle is **Whole device / Gesamtes Gerät**, including when the selected value is the heating + hot-water sum. Source metadata records the actual scope and selected features.

## Current-day validation

Each daily counter needs recognized energy units and a feature timestamp on the current local date in `time_zone`. A counter from another date or without a usable timestamp is withheld. For an array source, `day[0]` supplies the running day. The API owns the day buckets and resets; changing the display time zone does not repartition those buckets.

The transform records the selected features in `today_features`. Summed totals also retain their components' update times and age flags. These general feature-age flags are diagnostic metadata, not visible stale markers.

## Daily electricity history

The usage block shows seven daily electricity bars, oldest first: six completed days in black and today's running consumption in gray. Today's large numeric value remains to the right of the chart; the heat display shows today's total only. Bars share a zero baseline and an automatic scale. Missing days remain gaps, while genuine zero readings have a baseline tick.

The chart uses the API's existing daily arrays without extra requests or stored history. Dates follow the configured local calendar, including daylight-saving changes. Full layouts label every day; compact layouts label the first day and today. English and German labels follow the display language, while dates follow the configured time zone's regional format.

Historical bars come from `properties.day.value[1]` through `[6]`; today's bar uses the same selected value as the large number. Its array must have a feature timestamp from today in the configured time zone, using the same calendar-date check as today's daily counter. `properties.dayValueReadAt.value` controls only the age marker: it can lag even after the array rolls over and does not determine the date of its bins. An array whose feature timestamp is missing or from another day, a missing history bin, or an unsupported unit leaves the affected historical bar unavailable. Monthly and weekly counters are not used to reconstruct yesterday.

Device totals use device history. Each historical fallback sum requires the same uses as today, including cooling when it forms part of the electrical total; missing components are not treated as zero. When today's value is absent, valid historical bars may still be shown.

## Read-time markers

A daily value gets a small gray clock and **As of / Stand** date only when its selected feature explicitly supplies a valid `properties.dayValueReadAt.value` older than `stale_minutes` (default **120 minutes**). The date uses the configured local time and date formatter.

For a summed total, the oldest valid explicit read time among its selected components controls this marker. Individual use values are checked against their own selected sources. Missing or invalid read times produce no marker. The feature's general `timestamp` never substitutes for `dayValueReadAt` when deciding whether to show a marker.

The marker preserves the number and does not separately flag completed yesterday values. A recent read time is not a guarantee that the reported value agrees with ViCare. A feature timestamp can advance independently of the day-counter read time.

## Availability and diagnostics

Electricity and heat features can update independently. A successful API request retrieves the available cloud snapshot; it does not establish that every counter was reread from the device. ViCare and the public API can return different consumption values. The plugin has no documented public force-reread command.

The transform retains bounded electricity diagnostics in `energy.counter_readings`: enabled/status flags, feature timestamp, `dayValueReadAt`, current-day value, and the first two daily bins. It excludes tokens, commands, identifiers, and full history arrays. The [live polling helper](troubleshooting.md#verify-live-polling) logs these diagnostics alongside the selected source names.

Public examples of supported response shapes are available in [PyViCare's Vitocal 250-A fixture](https://github.com/openviess/PyViCare/blob/588a107b78f61c8982e43439c91b268acfdd02a9/tests/response/Vitocal250A.json). That fixture illustrates field structure, not the current readings or feature entitlement of another installation.
