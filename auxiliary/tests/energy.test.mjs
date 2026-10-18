import test from 'node:test';
import assert from 'node:assert/strict';
import { sample, context, transform, render, layouts, root } from '../build.mjs';
import { readFile } from 'node:fs/promises';

const stamp = '2026-10-18T18:00:00Z';
function reading(feature, property, value, unit, timestamp = stamp) {
  return { feature, isEnabled: true, timestamp, properties: { [property]: { value, unit } } };
}
function fixture(extra = [], cfg = {}) {
  const source = { ...structuredClone(sample), ...structuredClone(context) };
  source.demo = false;
  source.data.push(...extra);
  source.trmnl.plugin_settings.custom_fields_values = cfg;
  return source;
}
const devicePower = (value = 1800, unit = 'watt') => reading('heating.power.consumption.current', 'value', value, unit);
const compressor = (value = 1.4, unit = 'kilowatt') => reading('heating.compressors.0.power.consumption.current', 'value', value, unit);
const total = (value = 12.34, unit = 'kilowattHour', timestamp = stamp) => reading('heating.power.consumption.summary.total', 'currentDay', value, unit, timestamp);
const heat = value => reading('heating.power.consumption.summary.heating', 'currentDay', value, 'kilowattHour');
const water = value => reading('heating.power.consumption.summary.dhw', 'currentDay', value, 'kilowattHour');

test('whole-device electrical power is preferred over compressor-only input', () => {
  const result = transform(fixture([compressor(), devicePower(), total()]));
  assert.equal(result.energy.power_kw, 1.8);
  assert.equal(result.energy.power_scope, 'device');
  assert.equal(result.energy.today_kwh, 12.34);
  assert.equal(result.energy.today_scope, 'device');
});

test('compressor fallback is labelled as a component, not whole-device power', async () => {
  const source = fixture([compressor()]);
  assert.equal(transform(source).energy.power_scope, 'compressor');
  const html = await render(source);
  assert.match(html, /Compressor/);
  assert.match(html, /Electricity now/);
});

test('W/kW and Wh/kWh conversions preserve zero and numeric strings', () => {
  for (const [value, unit, expected] of [[1800, 'W', 1.8], [1.8, 'kW', 1.8], ['1800', 'watt', 1.8], [0, 'kilowatt', 0]]) {
    assert.equal(transform(fixture([devicePower(value, unit)])).energy.power_kw, expected);
  }
  for (const [value, unit, expected] of [[12340, 'Wh', 12.34], [12.34, 'kWh', 12.34], ['12.34', 'kilowattHour', 12.34], [0, 'kilowattHour', 0]]) {
    assert.equal(transform(fixture([total(value, unit)])).energy.today_kwh, expected);
  }
});

test('missing, wrong-unit, negative, disabled and errored readings remain unavailable', () => {
  const disabled = devicePower(); disabled.isEnabled = false;
  const error = devicePower(); error.properties.status = { value: 'error' };
  for (const extra of [[], [devicePower(-1)], [devicePower(12, 'kilowattHour')], [devicePower(12, '')], [disabled], [error]]) {
    assert.equal(transform(fixture(extra)).energy.power_kw, null);
  }
  assert.equal(transform(fixture([total(12, 'kilowatt')])).energy.today_kwh, null);
});

test('device total is not added again to heating and DHW counters', () => {
  const result = transform(fixture([total(14), heat(10), water(4)]));
  assert.equal(result.energy.today_kwh, 14);
  assert.equal(result.energy.today_scope, 'device');
});

test('daily fallback sums heating and DHW and includes cooling only when present', () => {
  let result = transform(fixture([heat(10), water(4)]));
  assert.equal(result.energy.today_kwh, 14);
  assert.equal(result.energy.today_scope, 'heating_dhw');
  const cooling = reading('heating.power.consumption.summary.cooling', 'currentDay', 2, 'kWh');
  result = transform(fixture([heat(10), water(4), cooling]));
  assert.equal(result.energy.today_kwh, 16);
  assert.equal(result.energy.today_scope, 'heating_dhw_cooling');
  assert.equal(transform(fixture([heat(10)])).energy.today_kwh, null);
});

test('a stale or unusable cooling component cannot silently disappear from the sum', () => {
  const cooling = reading('heating.power.consumption.summary.cooling', 'currentDay', 2, 'kWh', '2026-10-17T18:00:00Z');
  const result = transform(fixture([heat(10), water(4), cooling]));
  assert.equal(result.energy.today_kwh, null);
  assert.equal(result.energy.today_outdated, true);
});

test('legacy daily arrays use the newest bin once, not the sum of previous days', () => {
  const legacy = reading('heating.power.consumption.total', 'day', [7.5, 30, 40, 50], 'kilowattHour');
  const result = transform(fixture([legacy]));
  assert.equal(result.energy.today_kwh, 7.5);
  assert.equal(result.energy.today_scope, 'device');
});

test('yesterday or an undated counter is not presented as today', () => {
  for (const timestamp of ['2026-10-17T18:00:00Z', undefined, 'not-a-date']) {
    const item = total(); item.timestamp = timestamp;
    const result = transform(fixture([item]));
    assert.equal(result.energy.today_kwh, null);
    assert.equal(result.energy.today_outdated, true);
  }
});

test('local midnight invalidates yesterday even while the UTC date is unchanged', () => {
  const source = fixture([total(5, 'kWh', '2026-10-18T21:30:00Z')]);
  source.trmnl.system.timestamp_utc = Date.parse('2026-10-18T22:10:00Z') / 1000;
  const result = transform(source);
  assert.equal(result.energy.today_date, '2026-10-19');
  assert.equal(result.energy.today_kwh, null);
  source.data.at(-1).timestamp = '2026-10-18T22:05:00Z';
  assert.equal(transform(source).energy.today_kwh, 5);
});

test('hosted Serverless can use its own clock when trmnl.system is omitted', () => {
  const source = fixture();
  delete source.trmnl.system;
  const before = Math.floor(Date.now() / 1000);
  const result = transform(source);
  assert.ok(result.trmnl.system.timestamp_utc >= before);
  assert.ok(result.trmnl.system.timestamp_utc <= Math.floor(Date.now() / 1000));
  assert.match(result.energy.today_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('power is a timestamped snapshot with its own stale flag', () => {
  const item = devicePower(); item.timestamp = '2026-10-18T10:00:00Z';
  const result = transform(fixture([item, total()]));
  assert.equal(result.energy.power_kw, 1.8);
  assert.equal(result.energy.power_stale, true);
  assert.equal(result.energy.today_stale, false);
  assert.ok(result.energy.power_updated.includes('12:00'));
  assert.equal(result.freshness.stale, false);
});

test('configured features select their own units and scope; thermal production is rejected', () => {
  const source = fixture([
    reading('heating.heatingRod.power.consumption.current', 'value', 3000, 'W'),
    reading('heating.compressors.1.power.consumption.dhw', 'day', [2.5, 3], 'kWh')
  ], { current_power_feature: 'heating.heatingRod.power.consumption.current', daily_energy_feature: 'heating.compressors.1.power.consumption.dhw' });
  const result = transform(source);
  assert.equal(result.energy.power_kw, 3);
  assert.equal(result.energy.power_scope, 'heater');
  assert.equal(result.energy.today_kwh, 2.5);
  assert.equal(result.energy.today_scope, 'compressor');
  const thermal = reading('heating.heat.production.current', 'value', 10, 'kW');
  assert.equal(transform(fixture([thermal], { current_power_feature: thermal.feature })).energy.power_kw, null);
});

for (const layout of layouts) {
  test(`${layout} shows electrical power and daily energy in English and German`, async () => {
    const template = await readFile(new URL(`${layout}.liquid`, root), 'utf8');
    for (const language of ['en', 'de']) {
      const source = fixture([devicePower(), total()], { language });
      const html = await render(source, {}, template);
      assert.ok(html.includes(language === 'de' ? 'Strom aktuell' : 'Electricity now'));
      assert.ok(html.includes(language === 'de' ? 'Strom heute' : 'Electricity today'));
      assert.ok(html.includes(language === 'de' ? '1,8' : '1.8'));
      assert.ok(html.includes(language === 'de' ? '12,34' : '12.34'));
      assert.doesNotMatch(html, /NaN|undefined|\{%|\{\{/);
    }
  });
}

test('electrical input and thermal output keep distinct current and day values', () => {
  const source = fixture([
    devicePower(1800), total(12.34),
    reading('heating.heat.production.current', 'value', 7200, 'watt'),
    reading('heating.heat.production.total', 'day', [48.6, 60, 70], 'kilowattHour')
  ]);
  const result = transform(source);
  assert.equal(result.energy.power_kw, 1.8);
  assert.equal(result.energy.today_kwh, 12.34);
  assert.equal(result.heat.power_kw, 7.2);
  assert.equal(result.heat.today_kwh, 48.6);
  assert.equal(result.heat.power_scope, 'device');
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 15000);
});

test('heat fallback uses the compressor reading and heating/DHW counters, excluding cooling', () => {
  const source = fixture([
    reading('heating.compressors.0.heat.production.current', 'value', 8, 'kW'),
    reading('heating.heat.production.summary.heating', 'currentDay', 28, 'kWh'),
    reading('heating.heat.production.summary.dhw', 'currentDay', 7, 'kWh'),
    reading('heating.heat.production.summary.cooling', 'currentDay', 3, 'kWh')
  ]);
  const result = transform(source);
  assert.equal(result.heat.power_kw, 8);
  assert.equal(result.heat.power_scope, 'compressor');
  assert.equal(result.heat.today_kwh, 35);
  assert.equal(result.heat.today_scope, 'heating_dhw');
});

test('thermal feature overrides retain units and cannot consume electrical input features', () => {
  const source = fixture([
    reading('heating.heatingRod.heat.production.current', 'value', 3000, 'W'),
    reading('heating.heatingRod.heat.production.dhw', 'day', [2500, 3000], 'Wh')
  ], { current_heat_feature: 'heating.heatingRod.heat.production.current', daily_heat_feature: 'heating.heatingRod.heat.production.dhw' });
  const result = transform(source);
  assert.equal(result.heat.power_kw, 3);
  assert.equal(result.heat.power_scope, 'heater');
  assert.equal(result.heat.today_kwh, 2.5);
  assert.equal(result.heat.today_scope, 'heater');
  const wrong = transform(fixture([devicePower(), total()], { current_heat_feature: devicePower().feature, daily_heat_feature: total().feature }));
  assert.equal(wrong.heat.power_kw, null);
  assert.equal(wrong.heat.today_kwh, null);
});

test('thermal day counters also reject yesterday and preserve real zero', () => {
  const item = reading('heating.heat.production.total', 'day', [0, 30], 'kWh');
  assert.equal(transform(fixture([item])).heat.today_kwh, 0);
  item.timestamp = '2026-10-17T18:00:00Z';
  const result = transform(fixture([item]));
  assert.equal(result.heat.today_kwh, null);
  assert.equal(result.heat.today_outdated, true);
});

test('absent heat features are not inferred from electrical input or COP', () => {
  const source = fixture([devicePower(), total(), reading('heating.cop.total', 'value', 4, '')]);
  const result = transform(source);
  assert.equal(result.heat.power_kw, null);
  assert.equal(result.heat.today_kwh, null);
});

for (const layout of layouts) {
  test(`${layout} labels heat output separately in English and German`, async () => {
    const template = await readFile(new URL(`${layout}.liquid`, root), 'utf8');
    for (const language of ['en', 'de']) {
      const source = fixture([
        devicePower(), total(),
        reading('heating.heat.production.current', 'value', 7.2, 'kW'),
        reading('heating.heat.production.summary.total', 'currentDay', 48.6, 'kWh')
      ], { language });
      const html = await render(source, {}, template);
      for (const label of language === 'de'
        ? ['Strom aktuell', 'Strom heute', 'Wärme aktuell', 'Wärme heute', '7,2', '48,6']
        : ['Electricity now', 'Electricity today', 'Heat output now', 'Heat today', '7.2', '48.6']) assert.ok(html.includes(label), label);
    }
  });
}
