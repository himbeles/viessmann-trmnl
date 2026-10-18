import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import YAML from 'yaml';
import { render, sample, context, root, layouts, template } from '../build.mjs';

function options(language) {
  const trmnl = structuredClone(context.trmnl);
  trmnl.plugin_settings.custom_fields_values.language = language;
  return { trmnl };
}

for (const layout of layouts) {
  for (const language of ['en', 'de']) {
    test(`${layout} renders ${language} labels, numbers and dates`, async () => {
      const source = await readFile(new URL(`${layout}.liquid`, root), 'utf8');
      const html = await render(sample, options(language), source);
      const expected = language === 'de'
        ? ['lang="de"', 'Viessmann Wärmepumpe', '32,4', '48,2', '7,8', '0,5', 'Heizen + Warmwasser', 'DEMO · Beispieldaten', '18.10. 18:00', 'keine Viessmann-Sollwerte']
        : ['lang="en"', 'Viessmann heat pump', '32.4', '48.2', '7.8', '0.5', 'Heating + hot water', 'DEMO · Sample data', '2026-10-18 18:00', 'not Viessmann setpoints'];
      for (const text of expected) assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /NaN|undefined|\{%|\{\{/);
      if (language === 'en') assert.doesNotMatch(html, /Heizkurve|Wärmepumpe|Beispieldaten|Außentemperatur|Ältester/);
    });
  }
}

test('missing and unsupported language selections fall back to English', async () => {
  for (const language of [undefined, '', 'fr']) {
    const html = await render({}, options(language));
    assert.match(html, /lang="en"/);
    assert.match(html, /Not connected/);
    assert.match(html, /Reading timestamp missing/);
    assert.doesNotMatch(html, /Noch nicht verbunden/);
  }
});

test('German translates connection, missing and stale states', async () => {
  const empty = await render({}, options('de'));
  for (const text of ['Noch nicht verbunden', 'Messzeitpunkt fehlt', 'Werte unvollständig', 'Heizkurve erscheint']) assert.ok(empty.includes(text), text);
  const p = structuredClone(sample);
  p.demo = false;
  delete p.data[0].timestamp;
  assert.match(await render(p, options('de')), /Zeitstand unbekannt/);
  p.data[0].timestamp = '2020-01-01T00:00:00Z';
  const stale = await render(p, options('de'));
  assert.match(stale, /Daten veraltet/);
  assert.match(stale, /01\.01\. 00:00/);
});

test('known operating modes are localized in both languages', async () => {
  for (const [code, en, de] of [
    ['dhwAndHeating', 'Heating + hot water', 'Heizen + Warmwasser'],
    ['dhw', 'Hot water only', 'Nur Warmwasser'],
    ['heating', 'Heating', 'Heizen'],
    ['standby', 'Standby', 'Standby']
  ]) {
    const p = structuredClone(sample);
    p.data[4].properties.value.value = code;
    for (const [language, label] of [['en', en], ['de', de]]) {
      const html = await render(p, options(language));
      assert.ok(html.includes(`>${label}</div>`), `${code}: ${language}`);
    }
  }
});

test('root uses the official five plugin files with English settings and a language selector', async () => {
  const entries = (await readdir(root)).filter(name => !name.startsWith('.'));
  assert.deepEqual(entries.sort(), ['README.md', 'auxiliary', 'settings.yml', ...layouts.map(name => `${name}.liquid`)].sort());
  const settings = YAML.parse(await readFile(new URL('settings.yml', root), 'utf8'));
  assert.equal(settings.name, 'Viessmann heat pump');
  assert.equal(settings.strategy, 'polling');
  assert.equal(settings.no_screen_padding, 'no');
  assert.equal(settings.dark_mode, 'no');
  const language = settings.custom_fields.find(field => field.keyname === 'language');
  assert.equal(language.field_type, 'select');
  assert.equal(language.default, 'en');
  assert.deepEqual(language.options, [{ English: 'en' }, { Deutsch: 'de' }]);
  for (const layout of layouts) {
    const source = await readFile(new URL(`${layout}.liquid`, root), 'utf8');
    assert.ok(Buffer.byteLength(source) < 1_000_000);
    const classes = layout === 'full' ? 'vp' : layout === 'half_horizontal' ? 'vp vp-compact' : 'vp vp-compact vp-small';
    assert.equal(source, template.replace('class="vp"', `class="${classes}"`));
  }
});
