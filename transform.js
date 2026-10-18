// TRMNL Serverless (Node): reduce the full feature response before storage/rendering.
// Keep only dashboard readings and the few runtime settings used by the markup.
function run(input) {
  const source = input && typeof input === 'object' ? input : {};
  const cfg = source.trmnl?.plugin_settings?.custom_fields_values || {};
  const text = (value, fallback, limit = 256) => typeof value === 'string' && value.length > 0 && value.length <= limit ? value : fallback;
  const numeric = value => typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const circuit = text(String(cfg.circuit ?? '0'), '0', 8);
  const settings = {
    language: cfg.language === 'de' ? 'de' : 'en',
    circuit,
    supply_feature: text(cfg.supply_feature, 'heating.secondaryCircuit.sensors.temperature.supply'),
    water_feature: text(cfg.water_feature, 'heating.dhw.sensors.temperature.dhwCylinder'),
    outside_feature: text(cfg.outside_feature, 'heating.sensors.temperature.outside'),
    stale_minutes: numeric(cfg.stale_minutes) ?? 120,
    time_zone: text(cfg.time_zone, 'Europe/Berlin', 100),
    supply_setpoint_feature: text(cfg.supply_setpoint_feature, ''),
    water_setpoint_feature: text(cfg.water_setpoint_feature, 'heating.dhw.temperature.main'),
    curve_points: text(cfg.curve_points, '', 8000),
    max_supply_temperature: numeric(cfg.max_supply_temperature)
  };
  const fields = new Map([
    [settings.supply_feature, ['value', 'status']],
    [settings.water_feature, ['value', 'status']],
    [settings.outside_feature, ['value', 'status']],
    [`heating.circuits.${circuit}.heating.curve`, ['slope', 'shift']],
    [`heating.circuits.${circuit}.operating.modes.active`, ['value']]
  ]);
  const features = Array.isArray(source.IDX_0?.data) ? source.IDX_0.data : Array.isArray(source.data) ? source.data : [];
  const prefix = `heating.circuits.${circuit}`;
  const active = features.find(item => item?.feature === `${prefix}.operating.programs.active` && item.isEnabled !== false);
  const program = text(active?.properties?.value?.value, null, 80);
  fields.set(`${prefix}.operating.programs.active`, ['value']);
  fields.set(`${prefix}.operating.programs.normal`, ['temperature']);
  fields.set(`${prefix}.operating.programs.normalHeating`, ['temperature']);
  fields.set(`${prefix}.temperature.levels`, ['min', 'max']);
  if (program) fields.set(`${prefix}.operating.programs.${program}`, ['temperature']);
  if (settings.supply_setpoint_feature) fields.set(settings.supply_setpoint_feature, ['value', 'status']);
  fields.set(settings.water_setpoint_feature, ['value', 'status']);
  const data = [];
  for (const [name, keys] of fields) {
    const feature = features.find(item => item && item.feature === name);
    if (!feature) continue;
    const mode = name.endsWith('.operating.modes.active') || name.endsWith('.operating.programs.active');
    const properties = {};
    for (const key of keys) {
      const raw = feature.properties?.[key]?.value;
      properties[key] = { value: key === 'status' || mode ? text(raw, null, 128) : numeric(raw) };
    }
    const reading = { feature: name, isEnabled: feature.isEnabled !== false, properties };
    const timestamp = text(feature.timestamp, null, 64);
    if (timestamp) reading.timestamp = timestamp;
    data.push(reading);
  }
  const result = {
    data,
    trmnl: {
      system: { timestamp_utc: numeric(source.trmnl?.system?.timestamp_utc) ?? 0 },
      plugin_settings: { custom_fields_values: settings }
    }
  };
  const valid = name => data.find(item => item.feature === name && item.isEnabled && item.properties.status?.value !== 'error');
  const value = name => valid(name)?.properties?.value?.value ?? null;
  const room = program && program !== 'standby' ? valid(`${prefix}.operating.programs.${program}`)?.properties?.temperature?.value ?? null : null;
  result.setpoints = { room, supply: value(settings.supply_setpoint_feature), water: value(settings.water_setpoint_feature) };

  // Configuration timestamps describe setting changes, not sensor freshness.
  const sensors = [settings.supply_feature, settings.water_feature, settings.outside_feature].map(valid).filter(item => item && item.properties.value?.value != null);
  const times = sensors.map(item => Date.parse(item.timestamp));
  const knownTimes = times.filter(Number.isFinite);
  const oldest = knownTimes.length ? Math.min(...knownTimes) : null;
  const now = result.trmnl.system.timestamp_utc * 1000;
  let timeZone = settings.time_zone;
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { timeZone = 'UTC'; }
  settings.time_zone = timeZone;
  const formatTime = timestamp => timestamp === null || !Number.isFinite(timestamp) ? null : new Intl.DateTimeFormat(
    settings.language === 'de' ? 'de-DE' : 'en-GB',
    { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }
  ).format(timestamp);
  result.freshness = {
    oldest_sensor: formatTime(oldest), time_zone: timeZone,
    missing_time: sensors.length === 0 || knownTimes.length !== sensors.length,
    stale: oldest !== null && now > 0 && now - oldest > settings.stale_minutes * 60000
  };

  // E3 curve calculation used by PyViCare, with live circuit limits.
  // https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareHeatCurveCalculation.py
  let points = [];
  if (settings.curve_points) {
    try {
      const parsed = JSON.parse(settings.curve_points);
      if (Array.isArray(parsed) && parsed.length >= 2 && parsed.length <= 41 && parsed.every(point =>
        typeof point?.outdoor === 'number' && Number.isFinite(point.outdoor) && typeof point?.supply === 'number' && Number.isFinite(point.supply))) {
        points = parsed.map(point => ({ outdoor: point.outdoor, supply: point.supply })).sort((a, b) => a.outdoor - b.outdoor);
        if (new Set(points.map(point => point.outdoor)).size !== points.length) points = [];
      }
    } catch { /* Invalid reference data is flagged, never silently treated as exact. */ }
  }
  const reference = points.length > 0;
  const curveFeature = valid(`${prefix}.heating.curve`);
  const slope = curveFeature?.properties?.slope?.value;
  const shift = curveFeature?.properties?.shift?.value;
  const normalRoom = valid(`${prefix}.operating.programs.normalHeating`)?.properties?.temperature?.value
    ?? valid(`${prefix}.operating.programs.normal`)?.properties?.temperature?.value ?? null;
  const curveRoom = room ?? normalRoom;
  const limits = valid(`${prefix}.temperature.levels`)?.properties;
  const apiMax = limits?.max?.value ?? null;
  const maxSupply = apiMax ?? settings.max_supply_temperature;
  const minSupply = limits?.min?.value ?? null;
  const limitsValid = minSupply == null || maxSupply == null || minSupply <= maxSupply;
  const calculate = outdoor => {
    const delta = outdoor - curveRoom;
    let supply = curveRoom + shift - slope * delta * (1.4347 + 0.021 * delta + 0.0002479 * delta * delta);
    if (limitsValid && maxSupply != null) supply = Math.min(supply, maxSupply);
    if (limitsValid && minSupply != null) supply = Math.max(supply, minSupply);
    return supply;
  };
  if (!reference && slope != null && shift != null && curveRoom != null && limitsValid) {
    points = Array.from({ length: 51 }, (_, index) => {
      const outdoor = index - 30;
      return { outdoor, supply: calculate(outdoor) };
    }).filter(point => Number.isFinite(point.supply));
  }
  if (result.setpoints.supply == null && curveRoom != null && slope != null && shift != null && limitsValid) {
    const outdoor = value(settings.outside_feature);
    if (outdoor != null && Number.isFinite(calculate(outdoor))) {
      result.setpoints.supply = Math.round(calculate(outdoor) * 10) / 10;
      result.setpoints.supply_calculated = true;
    }
  }
  if (points.length) {
    const minX = points[0].outdoor, maxX = points[points.length - 1].outdoor;
    const minY = Math.floor((Math.min(...points.map(point => point.supply)) - 2) / 5) * 5;
    const maxY = Math.max(minY + 10, Math.ceil((Math.max(...points.map(point => point.supply), ...(!reference && maxSupply != null ? [maxSupply] : [])) + 2) / 5) * 5);
    const round = number => Math.round(number * 10) / 10;
    const plotted = points.map(point => ({
      outdoor: point.outdoor, supply: round(point.supply),
      x: round(48 + (point.outdoor - minX) / (maxX - minX) * 386),
      y: round(156 - (point.supply - minY) / (maxY - minY) * 132),
      label: reference || point.outdoor % 10 === 0
    }));
    result.curve = {
      reference, room_setpoint: curveRoom, max_supply: !reference && limitsValid ? maxSupply : null, max_from_api: apiMax != null,
      cap_y: !reference && maxSupply != null && limitsValid ? round(156 - (maxSupply - minY) / (maxY - minY) * 132) : null,
      invalid_reference: Boolean(settings.curve_points) && !reference,
      points: plotted, polyline: plotted.map(point => `${point.x},${point.y}`).join(' '),
      ticks: Array.from({ length: 5 }, (_, index) => ({
        value: round(minY + index * (maxY - minY) / 4), y: 156 - index * 33
      })),
      x_ticks: Array.from({ length: 6 }, (_, index) => ({ value: round(minX + index * (maxX - minX) / 5), x: 48 + index * 77.2 }))
    };
  }
  if (source.demo === true) result.demo = true;
  return result;
}
