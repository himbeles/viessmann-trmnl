import test from 'node:test';
import assert from 'node:assert/strict';
import { sample, context, transform, render } from '../build.mjs';

function fixture(cfg = {}) {
  const source = { ...structuredClone(sample), ...structuredClone(context) };
  source.demo = false;
  source.trmnl.plugin_settings.custom_fields_values = cfg;
  return source;
}
const feature = (source, name) => source.data.find(item => item.feature === name);

test('E3 graph includes all six requested points and applies the live upper cap', () => {
  const result = transform(fixture());
  const points = result.curve.points.filter(point => point.label);
  assert.deepEqual(points.map(point => point.outdoor), [-30, -20, -10, 0, 10, 20]);
  // Independent reference results for room=22, shift=2, slope=0.5, maximum=50.
  assert.deepEqual(points.map(point => point.supply), [50, 44.8, 40.3, 36, 31.3, 25.4]);
  assert.equal(result.curve.max_supply, 50);
  assert.equal(result.curve.max_from_api, true);
  assert.equal(result.curve.points.length, 51);
  assert.ok(result.curve.points.every(point => point.y >= 24 && point.y <= 156));
});

test('changing API slope, room setpoint and limits changes the complete curve dynamically', () => {
  const source = fixture();
  feature(source, 'heating.circuits.0.heating.curve').properties.slope.value = 1.2;
  feature(source, 'heating.circuits.0.temperature.levels').properties.max.value = 40;
  const capped = transform(source);
  assert.ok(capped.curve.points.filter(point => point.supply === 40).length > 5);
  assert.ok(capped.curve.points.every(point => point.supply <= 40));
  feature(source, 'heating.circuits.0.operating.programs.normal').properties.temperature.value = 24;
  assert.notDeepEqual(transform(source).curve.points, capped.curve.points);
});

test('API minimum is applied and API maximum takes precedence over fallback', () => {
  const source = fixture({ max_supply_temperature: '35' });
  feature(source, 'heating.circuits.0.temperature.levels').properties.min.value = 30;
  let result = transform(source);
  assert.equal(result.curve.max_supply, 50);
  assert.equal(result.curve.points.at(-1).supply, 30);
  source.data = source.data.filter(item => !item.feature.endsWith('.temperature.levels'));
  result = transform(source);
  assert.equal(result.curve.max_supply, 35);
  assert.equal(result.curve.max_from_api, false);
  assert.ok(result.curve.points.every(point => point.supply <= 35));
});

test('missing limits are disclosed and a missing room target is not assumed to be 20', async () => {
  const source = fixture();
  source.data = source.data.filter(item => !item.feature.endsWith('.temperature.levels'));
  assert.equal(transform(source).curve.max_supply, null);
  assert.match(await render(source), /Limit unavailable/);
  source.data = source.data.filter(item => !item.feature.endsWith('.operating.programs.normal'));
  assert.equal(transform(source).curve, undefined);
  assert.doesNotMatch(await render(source), /<polyline/);
});

test('direct supply setpoint, configured water target and active room target are kept separate', async () => {
  const source = fixture({ supply_setpoint_feature: 'custom.supply.target' });
  source.data.push({ feature: 'custom.supply.target', properties: { value: { value: 33 } }, isEnabled: true });
  const result = transform(source);
  assert.equal(result.setpoints.supply, 33);
  assert.equal(result.setpoints.supply_calculated, undefined);
  assert.equal(result.setpoints.water, 50);
  assert.equal(result.setpoints.room, 22);
  const html = await render(source);
  assert.match(html, /Target: 33 °C/);
  assert.match(html, /Target: 50 °C/);
  assert.match(html, /Room setpoint/);
  assert.match(html, /class="vp-mode"/);
});

test('model-derived supply target is explicitly marked as calculated', async () => {
  const source = fixture();
  assert.equal(transform(source).setpoints.supply_calculated, true);
  assert.match(await render(source), /Target \(calculated\)/);
});

test('old configuration and setpoint timestamps do not mark current sensors stale', () => {
  const source = fixture();
  for (const item of source.data) {
    if (!item.feature.includes('.sensors.temperature.')) item.timestamp = '2000-01-01T00:00:00Z';
  }
  const fresh = transform(source).freshness;
  assert.equal(fresh.stale, false);
  assert.equal(fresh.missing_time, false);
  assert.ok(fresh.oldest_sensor.includes('20:00'));
});

test('one old temperature timestamp still triggers the configured stale threshold', () => {
  const source = fixture({ stale_minutes: '5' });
  assert.equal(transform(source).freshness.stale, true);
  source.trmnl.plugin_settings.custom_fields_values.stale_minutes = '120';
  assert.equal(transform(source).freshness.stale, false);
  feature(source, 'heating.sensors.temperature.outside').timestamp = '2026-10-18T10:00:00Z';
  assert.equal(transform(source).freshness.stale, true);
});

test('Europe/Berlin adjusts for winter, summer and the DST transition', () => {
  for (const [utc, expected] of [
    ['2026-01-15T12:00:00Z', '13:00'],
    ['2026-07-15T12:00:00Z', '14:00'],
    ['2026-03-29T00:30:00Z', '01:30'],
    ['2026-03-29T01:30:00Z', '03:30']
  ]) {
    const source = fixture({ time_zone: 'Europe/Berlin' });
    for (const item of source.data) item.timestamp = utc;
    assert.ok(transform(source).freshness.oldest_sensor.includes(expected), utc);
  }
});

test('time zone changes formatting, not the stale calculation; invalid zones use UTC', () => {
  const source = fixture({ time_zone: 'America/New_York' });
  const ny = transform(source).freshness;
  assert.ok(ny.oldest_sensor.includes('14:00'));
  assert.equal(ny.stale, false);
  source.trmnl.plugin_settings.custom_fields_values.time_zone = 'invalid/timezone';
  const utc = transform(source).freshness;
  assert.equal(utc.time_zone, 'UTC');
  assert.ok(utc.oldest_sensor.includes('18:00'));
  assert.equal(utc.stale, ny.stale);
});

test('explicit curve reference points override the model without being presented as live API points', () => {
  const source = fixture({ curve_points: JSON.stringify([
    { outdoor: -30, supply: 45 }, { outdoor: -20, supply: 45 },
    { outdoor: -10, supply: 40 }, { outdoor: 0, supply: 35 },
    { outdoor: 10, supply: 30 }, { outdoor: 20, supply: 22 }
  ]) });
  const result = transform(source);
  assert.equal(result.curve.reference, true);
  assert.equal(result.curve.points.length, 6);
  assert.equal(result.curve.points[0].supply, 45);
});
