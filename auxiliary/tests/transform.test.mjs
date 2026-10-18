import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { sample, context, render, root } from '../build.mjs';

const code = await readFile(new URL('transform.js', root), 'utf8');
function transform(input) {
  return JSON.parse(JSON.stringify(vm.runInNewContext(`${code}\nrun(payload)`, { payload: input }, { timeout: 1000 })));
}
function input() {
  return { ...structuredClone(sample), ...structuredClone(context) };
}

test('reduces a response over 100 KB to small dashboard data without commands or credentials', () => {
  const large = input();
  large.oauth_access_token = 'TOKEN_MUST_NOT_BE_RETURNED';
  large.trmnl.previous_merge_variables = { padding: 'x'.repeat(200000) };
  large.data[0].commands = { set: { token: 'TOKEN_MUST_NOT_BE_RETURNED', padding: 'x'.repeat(170000) } };
  large.data.push({ feature: 'unrelated', properties: { value: { value: 'x'.repeat(170000) } } });
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 169679);
  const result = transform(large);
  const json = JSON.stringify(result);
  assert.equal(result.data.length, sample.data.length);
  assert.ok(Buffer.byteLength(json) < 15000);
  assert.doesNotMatch(json, /TOKEN_MUST_NOT_BE_RETURNED|commands|previous_merge_variables|unrelated/);
});

test('preserves all dashboard readings and English/German settings after transformation', async () => {
  for (const language of ['en', 'de']) {
    const source = input();
    source.trmnl.plugin_settings.custom_fields_values.language = language;
    const html = await render(transform(source));
    assert.ok(html.includes(language === 'de' ? '32,4' : '32.4'));
    assert.ok(html.includes(language === 'de' ? 'Heizen + Warmwasser' : 'Heating + hot water'));
    assert.ok(html.includes(language === 'de' ? '18.10.2026, 20:00' : '18/10/2026, 20:00'));
  }
});

test('custom sensor names and heating circuits select only requested features', async () => {
  const source = input();
  source.trmnl.plugin_settings.custom_fields_values = { circuit: '1', supply_feature: 'custom.supply' };
  source.data[0].feature = 'custom.supply';
  for (const feature of source.data) feature.feature = feature.feature.replace('heating.circuits.0.', 'heating.circuits.1.');
  const result = transform(source);
  assert.equal(result.data.length, sample.data.length);
  const html = await render(result);
  assert.match(html, /Heating circuit 1/);
  assert.match(html, /32\.4/);
});

test('keeps zero, negative, disabled and failed readings for correct markup handling', async () => {
  const source = input();
  source.data[0].properties.value.value = 0;
  source.data[1].isEnabled = false;
  source.data[2].properties.value.value = '-5.2';
  source.data[3].properties.shift.value = 0;
  const html = await render(transform(source));
  assert.match(html, />0<span/);
  assert.match(html, /-5\.2/);
  assert.match(html, />0 K/);
  assert.doesNotMatch(html, /48\.2/);
  source.data[0].properties.status = { value: 'error' };
  assert.equal(transform(source).data[0].properties.status.value, 'error');
});

test('supports IDX_0 input and bounds unexpected property text', () => {
  const source = input();
  source.data[4].properties.value.value = 'x'.repeat(200000);
  const result = transform({ IDX_0: source, trmnl: source.trmnl });
  assert.equal(result.data.length, sample.data.length);
  assert.equal(result.data[4].properties.value.value, null);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 15000);
});

test('empty or malformed responses never invent sensor values', () => {
  for (const source of [null, {}, { data: {} }, { data: [null, {}, { feature: 'other' }] }]) {
    assert.deepEqual(transform(source).data, []);
  }
});
