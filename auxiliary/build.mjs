import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Liquid } from 'liquidjs';
import vm from 'node:vm';

export const root = new URL('../src/', import.meta.url);
export const layouts = ['full', 'half_horizontal', 'half_vertical', 'quadrant'];
export const sample = {
  demo: true,
  data: [
    ['heating.secondaryCircuit.sensors.temperature.supply', { value: { value: 32.4 } }],
    ['heating.dhw.sensors.temperature.dhwCylinder', { value: { value: 48.2 } }],
    ['heating.sensors.temperature.outside', { value: { value: 7.8 } }],
    ['heating.circuits.0.heating.curve', { slope: { value: 0.5 }, shift: { value: 2 } }],
    ['heating.circuits.0.operating.modes.active', { value: { value: 'dhwAndHeating' } }],
    ['heating.circuits.0.operating.programs.active', { value: { value: 'normal' } }],
    ['heating.circuits.0.operating.programs.normal', { temperature: { value: 22 } }],
    ['heating.circuits.0.temperature.levels', { min: { value: 20 }, max: { value: 50 } }],
    ['heating.dhw.temperature.main', { value: { value: 50 } }]
  ].map(([feature, properties]) => ({ feature, properties, isEnabled: true, timestamp: '2026-10-18T18:00:00Z' }))
};
export const context = {
  trmnl: { system: { timestamp_utc: Date.parse('2026-10-18T18:10:00Z') / 1000 }, plugin_settings: { custom_fields_values: {} } }
};
export const engine = new Liquid({ strictFilters: true });
export const template = await readFile(new URL('full.liquid', root), 'utf8');
const transformCode = await readFile(new URL('transform.js', root), 'utf8');
export const transform = input => JSON.parse(JSON.stringify(vm.runInNewContext(`${transformCode}\nrun(payload)`, { payload: input }, { timeout: 1000 })));
export const render = (payload = {}, extra = {}, source = template) => engine.parseAndRender(source, transform({ ...context, ...payload, ...extra }));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, classes] of [['half_horizontal', 'vp-compact'], ['half_vertical', 'vp-compact vp-small'], ['quadrant', 'vp-compact vp-small']]) {
    await writeFile(new URL(`${name}.liquid`, root), template.replace('class="vp"', `class="vp ${classes}"`));
  }
  const output = new URL('./output/', import.meta.url);
  await mkdir(output, { recursive: true });
  const demoSample = structuredClone(sample);
  for (const [feature, property, value, unit] of [
    ['heating.compressors.0.power.consumption.current', 'value', 1.8, 'kilowatt'],
    ['heating.power.consumption.summary.total', 'currentDay', 12.34, 'kilowattHour'],
    ['heating.compressors.0.heat.production.current', 'value', 7.2, 'kilowatt'],
    ['heating.heat.production.total', 'day', [48.6, 50], 'kilowattHour']
  ]) demoSample.data.push({ feature, isEnabled: true, timestamp: '2026-10-18T18:00:00Z', properties: { [property]: { value, unit } } });
  await writeFile(new URL('demo-data.json', output), JSON.stringify(demoSample, null, 2) + '\n');
  const views = {};
  for (const language of ['en', 'de']) {
    const trmnl = structuredClone(context.trmnl);
    trmnl.plugin_settings.custom_fields_values.language = language;
    for (const state of ['demo', 'empty']) views[`${language}-${state}`] = await render(state === 'demo' ? demoSample : {}, { trmnl });
  }
  await writeFile(new URL('preview.html', output), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Viessmann heat pump · TRMNL preview</title>
<style>body{margin:0;background:#e8e7e2;color:#111;font:15px Arial,sans-serif;padding:24px}main{max-width:1100px;margin:auto}h1{font-size:24px}p{line-height:1.6}.screen{aspect-ratio:5/3;background:white;border:2px solid #000;margin:24px 0;overflow:hidden}.screen .vp{height:100%}select{padding:8px;margin-right:16px}footer{font-size:13px}@media(max-width:650px){body{padding:12px}.screen{min-width:600px}.scroll{overflow:auto}.vp-value{font-size:42px}}</style>
<main><h1>Viessmann heat pump · TRMNL X</h1><p>Local layout preview. Sample data does not come from your heat pump.</p>
<label>Plugin language <select id="language"><option value="en">English</option><option value="de">Deutsch</option></select></label>
<label>Data <select id="state"><option value="demo">Sample data</option><option value="empty">Not connected</option></select></label>
<div class="scroll"><div id="screen" class="screen">${views['en-demo']}</div></div>
${Object.entries(views).map(([key, html]) => `<template id="${key}">${html}</template>`).join('\n')}
<footer>The chart is calculated from live curve settings using the E3 model and available supply limits. Compare calculated values with ViCare. This is a read-only display.</footer></main>
<script>for(const id of ['language','state'])document.getElementById(id).addEventListener('change',()=>{const key=document.getElementById('language').value+'-'+document.getElementById('state').value;document.getElementById('screen').replaceChildren(document.getElementById(key).content.cloneNode(true))})</script></html>\n`);
}
