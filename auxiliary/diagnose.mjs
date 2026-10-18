// Read-only inspection. Never log exports, field values, headers or OAuth tokens.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
const exec = promisify(execFile);
const id = 510867;
const key = process.env.TRMNL_API_KEY;
if (!key) throw new Error('TRMNL_API_KEY is required.');
const directory = await mkdtemp(join(tmpdir(), 'trmnl-diagnostic-'));
const present = value => value != null && String(value).trim() !== '';
async function api(path) {
  return new Promise((resolve, reject) => {
    const child = execFile('curl', ['--fail', '--silent', '--show-error', '--config', '-',
      `https://trmnl.com/api/plugin_settings/${id}/${path}`], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(`TRMNL diagnostic request failed: ${path}`));
      else { try { resolve(JSON.parse(stdout).data); } catch { reject(new Error('Invalid diagnostic response.')); } }
    });
    child.stdin.end(`header = "Authorization: Bearer ${key.replaceAll('"', '\\"')}"\n`);
  });
}
try {
  const archive = join(directory, 'plugin.zip');
  // Header is passed on stdin rather than as a command-line argument.
  const child = execFile('curl', ['--fail', '--silent', '--show-error', '--config', '-', '--output', archive,
    `https://trmnl.com/api/plugin_settings/${id}/archive`]);
  child.stdin.end(`header = "Authorization: Bearer ${key.replaceAll('"', '\\"')}"\n`);
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Archive download failed (exit ${code}).`))); });
  const { stdout } = await exec('python3', ['-c',
    'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:z.read(n).decode() for n in z.namelist() if n in ["settings.yml","transform.js"]}))', archive], { maxBuffer: 4 * 1024 * 1024 });
  const files = JSON.parse(stdout);
  const settings = YAML.parse(files['settings.yml']);
  const rawFields = settings.custom_fields;
  const fields = typeof rawFields === 'string' ? YAML.parse(rawFields) : rawFields || [];
  const values = settings.custom_fields_values || {};
  const digest = value => createHash('sha256').update(value || '').digest('hex');
  const details = await api('details');
  const status = await api('logs?limit=1');
  const merge = await api('merge_variables');
  const describe = value => Array.isArray(value) ? { type: 'array', length: value.length }
    : value && typeof value === 'object' ? { type: 'object', keys: Object.keys(value) } : { type: typeof value };
  console.log(JSON.stringify({
    live_state: details.state,
    live_oauth_enabled: details.settings?.oauth_enabled,
    live_pkce_enabled: details.settings?.oauth_pkce_enabled,
    live_polling_header_present: present(details.settings?.polling_headers),
    live_oauth_client_id_present: present(details.settings?.oauth_client_id),
    live_settings_keys: Object.keys(details.settings || {}),
    available_fields: describe(details.available_fields),

    health_state: status.health?.state,
    retry_count: status.health?.error_retry_count,
    last_refresh: status.health?.last_refresh,
    variables_structure: Object.fromEntries(Object.entries(merge.variables || {}).map(([name, value]) => [name, describe(value)])),
    id: settings.id,
    exported_keys: Object.keys(settings),
    strategy: settings.strategy,
    refresh_interval: settings.refresh_interval,
    serverless_language: settings.serverless_language,
    has_polling_url: present(settings.polling_url),
    polling_url_placeholders: [...String(settings.polling_url || '').matchAll(/{{\s*([a-z_]+)/g)].map(match => match[1]),
    has_polling_headers: present(settings.polling_headers),
    headers_use_oauth_token: String(settings.polling_headers || '').includes('oauth_access_token'),
    oauth_pkce_enabled: settings.oauth_pkce_enabled,
    oauth_enabled: settings.oauth_enabled,
    oauth_fields_present: Object.fromEntries(Object.entries(settings).filter(([name]) => name.startsWith('oauth_')).map(([name, value]) => [name, present(value)])),
    field_count: fields.length,
    required_device_values: Object.fromEntries(['installation_id', 'gateway_serial', 'device_id'].map(name => [name, { saved_value_present: present(values[name]), definition_present: fields.some(field => field.keyname === name), default_present: fields.some(field => field.keyname === name && present(field.default)) }])),
    transform_present: present(files['transform.js']),
    transform_matches_repository: digest(files['transform.js']) === digest(await readFile(new URL('../src/transform.js', import.meta.url), 'utf8'))
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
