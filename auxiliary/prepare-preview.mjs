import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import YAML from 'yaml';

const root = new URL('../', import.meta.url);
const destination = new URL('./output/preview-plugin/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('src/', root), new URL('src/', destination), { recursive: true });
const settings = YAML.parse(await readFile(new URL('src/settings.yml', root), 'utf8'));
const data = JSON.parse(await readFile(new URL('./output/demo-data.json', import.meta.url), 'utf8'));
for (const key of Object.keys(settings)) {
  if (key === 'id' || key.startsWith('polling_') || key.startsWith('oauth_')) delete settings[key];
}
settings.strategy = 'static';
settings.static_data = JSON.stringify(data);
await writeFile(new URL('src/settings.yml', destination), YAML.stringify(settings));
await cp(new URL('.trmnlp.yml', root), new URL('.trmnlp.yml', destination));
console.log('Prepared auxiliary/output/preview-plugin using synthetic data. No Viessmann login is needed.');
