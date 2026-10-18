import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Liquid } from 'liquidjs';

export const root = new URL('../', import.meta.url);
export const layouts = ['full', 'half_horizontal', 'half_vertical', 'quadrant'];
export const sample = {
  demo: true,
  data: [
    ['heating.secondaryCircuit.sensors.temperature.supply', { value: { value: 32.4 } }],
    ['heating.dhw.sensors.temperature.dhwCylinder', { value: { value: 48.2 } }],
    ['heating.sensors.temperature.outside', { value: { value: 7.8 } }],
    ['heating.circuits.0.heating.curve', { slope: { value: 0.5 }, shift: { value: 2 } }],
    ['heating.circuits.0.operating.modes.active', { value: { value: 'dhwAndHeating' } }]
  ].map(([feature, properties]) => ({ feature, properties, isEnabled: true, timestamp: '2026-10-18T18:00:00Z' }))
};
export const context = {
  trmnl: { system: { timestamp_utc: Date.parse('2026-10-18T18:10:00Z') / 1000 }, plugin_settings: { custom_fields_values: {} } }
};
export const engine = new Liquid({ strictFilters: true });
export const template = await readFile(new URL('full.liquid', root), 'utf8');
export const render = (payload = {}, extra = {}, source = template) => engine.parseAndRender(source, { ...context, ...payload, ...extra });

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, classes] of [['half_horizontal', 'vp-compact'], ['half_vertical', 'vp-compact vp-small'], ['quadrant', 'vp-compact vp-small']]) {
    await writeFile(new URL(`${name}.liquid`, root), template.replace('class="vp"', `class="vp ${classes}"`));
  }
  const output = new URL('./output/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('demo-data.json', output), JSON.stringify(sample, null, 2) + '\n');
  const views = {};
  for (const language of ['en', 'de']) {
    const trmnl = structuredClone(context.trmnl);
    trmnl.plugin_settings.custom_fields_values.language = language;
    for (const state of ['demo', 'empty']) views[`${language}-${state}`] = await render(state === 'demo' ? sample : {}, { trmnl });
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
<footer>The chart is schematic and does not calculate Viessmann setpoints. This is a read-only display.</footer></main>
<script>for(const id of ['language','state'])document.getElementById(id).addEventListener('change',()=>{const key=document.getElementById('language').value+'-'+document.getElementById('state').value;document.getElementById('screen').replaceChildren(document.getElementById(key).content.cloneNode(true))})</script></html>\n`);
}
