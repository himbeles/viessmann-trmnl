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
    stale_minutes: numeric(cfg.stale_minutes) ?? 120
  };
  const fields = new Map([
    [settings.supply_feature, ['value', 'status']],
    [settings.water_feature, ['value', 'status']],
    [settings.outside_feature, ['value', 'status']],
    [`heating.circuits.${circuit}.heating.curve`, ['slope', 'shift']],
    [`heating.circuits.${circuit}.operating.modes.active`, ['value']]
  ]);
  const features = Array.isArray(source.IDX_0?.data) ? source.IDX_0.data : Array.isArray(source.data) ? source.data : [];
  const data = [];
  for (const [name, keys] of fields) {
    const feature = features.find(item => item && item.feature === name);
    if (!feature) continue;
    const mode = name.endsWith('.operating.modes.active');
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
  if (source.demo === true) result.demo = true;
  return result;
}
