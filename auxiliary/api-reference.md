# Sensor, status, and curve reference

The implementation is [src/transform.js](../src/transform.js); rendering and translations are in [src/shared.liquid](../src/shared.liquid). Feature names below use `N` for the configured heating circuit or component index. The transform accepts a feature array in `data` or `IDX_0.data`.

## Temperature and pressure readings

| Displayed value | API feature | Property |
|---|---|---|
| Actual heating-circuit supply | `heating.circuits.N.sensors.temperature.supply` | `value.value` |
| Heating-circuit supply target | `heating.circuits.N.temperature` | `value.value` |
| Hot-water cylinder | Configured `water_feature` | `value.value` |
| Hot-water target | Configured `water_setpoint_feature` | `value.value` |
| Outdoor temperature | Configured `outside_feature` | `value.value` |
| Room target | `heating.circuits.N.operating.programs.PROGRAM` | `temperature.value` |
| Water pressure | `heating.sensors.pressure.supply` | `value.value`, `value.unit` |

Property paths in this table are relative to `properties`. `PROGRAM` comes from `heating.circuits.N.operating.programs.active.properties.value.value`. Standby does not supply a room target. Plot calculation can use a normal/normalHeating program when the active program has no target.

The displayed circuit supply and target are strictly circuit readings. They remain visible when idle, provided they are available. A missing circuit sensor or target is not replaced with a heat-pump sensor, a custom diagnostic override, or a curve estimate. Return temperatures are not displayed.

The diagnostic supply model supports automatic circuit-first selection, a secondary-circuit fallback, and custom feature selection through `supply_feature`. The diagnostic `setpoints.supply` model can use `supply_setpoint_feature` and a calculated fallback. These models do not change the circuit readings or target marker displayed by the dashboard.

Pressure is water pressure, not compressor/refrigerant pressure. The transform converts bar, Pa, kPa, hPa, and mbar representations to bar. Unsupported units and negative pressure are unavailable. Temperature zero and negative outdoor readings are valid. Disabled sensors and sensors reporting error, disconnected, or unavailable status do not supply displayed values.

## Activity badge and active block

The badge indicates the circuit currently being served, rather than the configured operating mode:

1. Active `heating.dhw.charging.properties.active.value`, or operation state `dhw`/`domesticHotWater`, identifies hot-water activity.
2. `heating.secondaryCircuit.operation.state.properties.currentValue.value` of `standby` or `off` identifies off.
3. Operation state `heating` identifies heating unless `heating.valves.fourThreeWay.position.properties.value.value` is `domesticHotWater`.
4. Without an operation-state reading, known charging=false plus the selected circuit circulation pump's `status` of on/off identifies heating/off.
5. Incomplete or unsupported signals, including cooling/defrost states, remain unknown.

Valve position alone does not establish activity. The heating block's thick border additionally requires the selected circuit circulation pump to be on; the hot-water block uses hot-water activity. Configured operating modes do not establish that a compressor or heater is running.

## Component states

| Component | Source | Interpretation |
|---|---|---|
| Compressor | `heating.compressors.N.properties.active.value` | Any true value means on; all reported valid inactive compressors means off. |
| Electric auxiliary heating | `heating.heatingRod.status.properties.overall.value` | A boolean reports the overall running state. |
| Auxiliary stages | `heating.heatingRod.status.properties.level1/level2/level3.value` | Used without an overall state: any true stage means on; all three false means off. |
| Auxiliary electrical draw | `heating.heatingRod.power.consumption.current.properties.value` | Fallback when stage status is unknown: positive W/kW means on; zero means off. |
| Fan | `heating.primaryCircuit.fans.N.current.properties.value.value` | Any positive speed means on; all reported valid zero speeds means off. |

Unavailable or disabled readings do not count as false/zero. In a group, a known running component establishes on; otherwise every reported component must have a valid inactive reading to establish off. Incomplete groups remain unknown and show a dash.

`heating.heatingRod.properties.active.value` means heater availability. Neither availability nor `heating.configuration.heatingRod.*.useApproved` establishes that the auxiliary heater is running.

## Heating curve

Slope and offset come from `heating.circuits.N.heating.curve.properties.slope.value` and `.shift.value`. With outdoor temperature `x`, room target `t`, slope `s`, offset `n`, and `d = x − t`, the E3 model is:

```text
unlimited supply = t + n − s × d × (1.4347 + 0.021 × d + 0.0002479 × d²)
```

This model follows [PyViCare's E3 calculation](https://github.com/openviess/PyViCare/blob/master/PyViCare/PyViCareHeatCurveCalculation.py). The plugin calculates points from **−30 to 20 °C**, at 1 °C intervals, with dots and x-axis ticks at 10 °C steps.

The minimum and maximum come from `heating.circuits.N.temperature.levels.properties.min.value` and `.max.value`. `max_supply_temperature` supplies a maximum only when the API omits it. Command parameter constraints are not configured temperature limits. Limits produce the capped sections of the curve. Missing slope, offset, or room target prevents a calculated curve; no room temperature is assumed.

Valid `curve_points` replace the model with the supplied reference points. Invalid references are flagged. The reference mode and calculated curve are distinct from a directly exported ViCare curve; device control, room feedback, and filtered outdoor temperatures can affect the curve used by the heat pump.

The diamond marker uses the actual circuit target and current outdoor temperature. It is omitted if either is unavailable. The actual supply reading is displayed beside the graph and is not a graph marker. Axis bounds cover the curve and target. The display does not include a return reading, temperature-pair list, or separate maximum-limit line.

## Dates and freshness

Timestamps are converted to the configured IANA time zone using `Intl.DateTimeFormat`, with daylight-saving transitions. The transform uses IANA zone-to-country mappings and ICU locale handling to select a regional date pattern independently of the label language. Calendar dates use Gregorian years, Latin digits, and 24-hour time. UTC/fixed-offset zones use an ISO-style date; invalid zones fall back to UTC. Zone abbreviations are not rendered.

The footer uses the latest timestamp among eligible displayed readings and counters. It is not a guarantee of freshness for every displayed value. Sensor and power age metadata remains available for diagnostics but does not create visible age warnings.

Only stale explicit `dayValueReadAt` timestamps produce a visible clock and read-date marker. See [daily-counter freshness](api-energy-fields.md#read-time-markers). No missing-timestamp warning is rendered. An unchanged setting, component state, or reading alone does not establish stale data. An offline E-Ink device retains its previous image until it renders again.

## References

- [Viessmann data-point catalogue](https://api.viessmann-climatesolutions.com/documentation/data-points)
- [Viessmann public API documentation](https://api.viessmann-climatesolutions.com/documentation)
- [PyViCare heat-pump implementation](https://github.com/openviess/PyViCare/blob/master/PyViCare/PyViCareHeatPump.py)
- [PyViCare heating-device implementation](https://github.com/openviess/PyViCare/blob/master/PyViCare/PyViCareHeatingDevice.py)
