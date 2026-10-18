import test from 'node:test';
import assert from 'node:assert/strict';
import {render,sample,context} from '../build.mjs';

test('disconnected renders placeholders without an invented curve',async()=>{
  const html=await render();
  assert.match(html,/Not connected/);assert.doesNotMatch(html,/<polyline/);assert.doesNotMatch(html,/NaN|undefined/);
});
test('API-shaped fixture renders all metrics and labelled calculated curve',async()=>{
  const html=await render(sample);
  for(const text of ['32.4','48.2','7.8','0.5','Heating + hot water','DEMO · Sample data','Calculated · API settings'])assert.ok(html.includes(text),text);
  assert.match(html,/<polyline/);assert.doesNotMatch(html,/NaN|undefined/);
});
test('zero and negative temperatures survive mapping',async()=>{
  const p=structuredClone(sample);p.data[0].properties.value.value=0;p.data[2].properties.value.value=-5.2;p.data[3].properties.shift.value=0;
  const html=await render(p);assert.match(html,/>0<span/);assert.match(html,/-5.2/);assert.match(html,/>0 K/);
});
test('disabled and failed sensors are not displayed',async()=>{
  const p=structuredClone(sample);p.data[0].isEnabled=false;p.data[1].properties.status={value:'error'};
  const html=await render(p);assert.doesNotMatch(html,/>32\.4<span|>48\.2<span/);assert.match(html,/Incomplete data/);
});
test('oldest displayed timestamp determines stale flag',async()=>{
  const p=structuredClone(sample);p.demo=false;p.data[2].timestamp='2020-01-01T00:00:00Z';
  const html=await render(p);assert.match(html,/Stale data/);assert.ok(html.includes('01/01/2020, 01:00'));
});
test('missing timestamps are explicitly identified',async()=>{
  const p=structuredClone(sample);p.demo=false;delete p.data[0].timestamp;
  const html=await render(p);assert.match(html,/Timestamp unknown/);
});
test('custom sensor mapping and another circuit work',async()=>{
  const p=structuredClone(sample);p.data[0].feature='custom.supply';p.data[3].feature='heating.circuits.1.heating.curve';p.data[4].feature='heating.circuits.1.operating.modes.active';
  const trmnl=structuredClone(context.trmnl);trmnl.plugin_settings.custom_fields_values={circuit:'1',supply_feature:'custom.supply'};
  const html=await render(p,{trmnl});assert.match(html,/32.4/);assert.match(html,/0.5/);assert.match(html,/Heating circuit 1/);
});
test('multi-URL response wrapper and unknown status escape safely',async()=>{
  const p=structuredClone(sample);p.data[4].properties.value.value='<script>bad</script>';
  const html=await render({IDX_0:p});assert.match(html,/32.4/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>bad/);
});
