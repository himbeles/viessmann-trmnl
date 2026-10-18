import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Liquid } from 'liquidjs';
import YAML from 'yaml';

export const fields = [
  ['circuit', 'Heizkreis (0 = erster Heizkreis)', '0'],
  ['supply_feature', 'API-Feature: Vorlauftemperatur', 'heating.secondaryCircuit.sensors.temperature.supply'],
  ['water_feature', 'API-Feature: Warmwasserspeicher', 'heating.dhw.sensors.temperature.dhwCylinder'],
  ['outside_feature', 'API-Feature: Außentemperatur', 'heating.sensors.temperature.outside'],
  ['stale_minutes', 'Veraltet nach Minuten', '120']
].map(([keyname,name,value]) => ({keyname,name,field_type:'string',default:value,optional:true}));

export const sample = {
  demo: true,
  data: [
    ['heating.secondaryCircuit.sensors.temperature.supply',{value:{value:32.4}}],
    ['heating.dhw.sensors.temperature.dhwCylinder',{value:{value:48.2}}],
    ['heating.sensors.temperature.outside',{value:{value:7.8}}],
    ['heating.circuits.0.heating.curve',{slope:{value:0.5},shift:{value:2}}],
    ['heating.circuits.0.operating.modes.active',{value:{value:'dhwAndHeating'}}]
  ].map(([feature,properties])=>({feature,properties,isEnabled:true,timestamp:'2026-10-18T18:00:00Z'}))
};

export const context = {trmnl:{system:{timestamp_utc:1792347000},plugin_settings:{custom_fields_values:{}}}};
export const engine = new Liquid({strictFilters:true});
export const template = await readFile(new URL('./src/full.liquid',import.meta.url),'utf8');
export const render = (payload={},extra={}) => engine.parseAndRender(template.replace('VP_LAYOUT_CLASS',''),{...context,...payload,...extra});

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  await mkdir('dist',{recursive:true});
  const base={name:'Viessmann Wärmepumpe',strategy:'static',refresh_interval:60,static_data:JSON.stringify({data:[]}),no_screen_padding:'no',dark_mode:'no',custom_fields:fields};
  await writeFile('src/settings.yml',YAML.stringify(base));
  const live={...base,name:'Viessmann Wärmepumpe · API',strategy:'polling',
    polling_url:'https://api.viessmann-climatesolutions.com/iot/v2/features/installations/{{ installation_id | url_encode }}/gateways/{{ gateway_serial | url_encode }}/devices/{{ device_id | url_encode }}/features/',
    polling_headers:'Authorization: Bearer {{ oauth_access_token }}',polling_verb:'GET',
    oauth_enabled:'true',oauth_authorize_url:'https://iam.viessmann-climatesolutions.com/idp/v3/authorize',oauth_token_url:'https://iam.viessmann-climatesolutions.com/idp/v3/token',
    oauth_scopes:'IoT User offline_access',oauth_pkce_enabled:'true',oauth_token_request_auth_method:'body',
    custom_fields:[
      {keyname:'installation_id',name:'API-Installations-ID',field_type:'string'},
      {keyname:'gateway_serial',name:'Gateway-Seriennummer aus der API',field_type:'string'},
      {keyname:'device_id',name:'API-Geräte-ID (mit Geräteliste abgleichen)',field_type:'string',default:'1'},...fields]};
  delete live.static_data;
  await writeFile('dist/settings-live.yml',YAML.stringify(live));
  await writeFile('dist/demo-data.json',JSON.stringify(sample,null,2));
  for(const [name,cls] of [['full',''],['half_horizontal','vp-compact'],['half_vertical','vp-compact vp-small'],['quadrant','vp-compact vp-small']]){
    await writeFile(`dist/${name}.liquid`,template.replace('VP_LAYOUT_CLASS',cls));
  }
  const demo=await render(sample);
  const empty=await render();
  await writeFile('dist/preview.html',`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Viessmann · TRMNL Vorschau</title><style>body{margin:0;background:#e8e7e2;color:#111;font:15px Arial,sans-serif;padding:32px}main{max-width:1100px;margin:auto}h1{font-size:24px}p{line-height:1.6}.screen{aspect-ratio:5/3;background:white;border:2px solid #000;margin:24px 0;overflow:hidden}.screen .vp{height:100%}button{border:2px solid #111;background:white;color:black;padding:10px 18px;cursor:pointer;font-weight:bold}button[aria-pressed=true]{background:black;color:white}footer{font-size:13px} @media(max-width:650px){body{padding:12px}.screen{min-width:600px}.scroll{overflow:auto}.vp-brand{font-size:18px}.vp-value{font-size:42px}}</style><main><h1>Viessmann Wärmepumpe · TRMNL X</h1><p>IDU-A Modular · AWMIW.A1.19-V051<br>Lokale Layout-Vorschau. Beispieldaten sind keine Messwerte deiner Anlage.</p><button id="demo" aria-pressed="true">Beispieldaten</button> <button id="empty" aria-pressed="false">Ohne Verbindung</button><div class="scroll"><div id="screen" class="screen">${demo}</div></div><template id="demo-view">${demo}</template><template id="empty-view">${empty}</template><footer>Die Heizkurve ist ein lineares Schema: 20 + Niveau + Neigung × (20 − Außentemperatur). Die tatsächliche Viessmann-Kennlinie ist modellabhängig und kann abweichen. Keine Regelungs- oder Einstellungsfunktion.</footer></main><script>for(const id of ['demo','empty'])document.getElementById(id).addEventListener('click',()=>{document.getElementById('screen').replaceChildren(document.getElementById(id+'-view').content.cloneNode(true));for(const key of ['demo','empty'])document.getElementById(key).setAttribute('aria-pressed',String(key===id))})</script></html>`);
}
