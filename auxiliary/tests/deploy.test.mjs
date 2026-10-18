import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { mergeSettings, deploy, projectRoot } from '../deploy.mjs';

test('updating an existing instance retains OAuth, polling and configured values', () => {
  const installed = {
    id: 510867, name: 'My existing dashboard',
    oauth_client_id: 'synthetic-client', oauth_pkce_enabled: 'yes', oauth_scopes: 'existing-scopes',
    polling_url: 'https://example.invalid/my-device', polling_headers: 'saved-header', refresh_interval: 15,
    custom_fields_values: { installation_id: 'synthetic-installation', language: 'de' },
    custom_fields: [{ keyname: 'language', name: 'Old name', default: 'de' }, { keyname: 'extra', name: 'Keep me' }]
  };
  const before = structuredClone(installed);
  const merged = mergeSettings({
    id: 999, oauth_client_id: 'must-not-overwrite', polling_url: 'must-not-overwrite',
    custom_fields: [{ keyname: 'language', name: 'Display language', default: 'en' }, { keyname: 'time_zone', name: 'Display time zone' }]
  }, installed, 510867);
  for (const key of ['name', 'oauth_client_id', 'oauth_pkce_enabled', 'oauth_scopes', 'polling_url', 'polling_headers', 'refresh_interval', 'custom_fields_values']) {
    assert.deepEqual(merged[key], installed[key], key);
  }
  assert.equal(merged.id, 510867);
  assert.equal(merged.serverless_language, 'node');
  assert.equal(merged.custom_fields.find(field => field.keyname === 'language').name, 'Display language');
  assert.equal(merged.custom_fields.find(field => field.keyname === 'language').default, 'de');
  assert.ok(merged.custom_fields.some(field => field.keyname === 'extra'));
  assert.ok(merged.custom_fields.some(field => field.keyname === 'time_zone'));
  assert.deepEqual(installed, before);
});

test('Viessmann PKCE remains enabled even when the exported instance disabled it', () => {
  for (const value of [false, 'false', 'no', 'true', true, 'yes', '', null, undefined]) {
    const merged = mergeSettings({ oauth_pkce_enabled: 'true', polling_headers: 'Authorization=Bearer {{ oauth_access_token }}' },
      { id: 510867, oauth_pkce_enabled: value }, 510867);
    assert.equal(merged.oauth_pkce_enabled, 'yes');
    assert.equal(merged.oauth_enabled, 'yes');
  }
});

test('redacted export headers are restored from the public OAuth template', () => {
  const header = 'Authorization=Bearer {{ oauth_access_token }}';
  for (const redacted of [undefined, null, '', '  ']) {
    const merged = mergeSettings({ polling_headers: header }, { id: 510867, polling_headers: redacted }, 510867);
    assert.equal(merged.polling_headers, header);
    assert.ok(!Object.hasOwn(merged, 'oauth_access_token'));
  }
  assert.throws(() => mergeSettings({}, { id: 510867, polling_headers: '' }, 510867), /authentication header/);
});

test('missing or mismatched IDs and unexpected fields abort an update', () => {
  for (const installed of [{}, { id: 1 }, { id: 510867, custom_fields: 'not an array' }]) {
    assert.throws(() => mergeSettings({ custom_fields: [] }, installed, 510867));
  }
  assert.throws(() => mergeSettings({}, { id: 510867 }, 0));
});

test('dry run clones and checks the existing plugin without uploading', async () => {
  const calls = [];
  let staging;
  await deploy({ runner: async (args, cwd) => {
    calls.push(args);
    if (args[0] === 'clone') {
      assert.equal(args.at(-1), '510867');
      staging = join(cwd, args[2]);
      await mkdir(join(staging, 'src'), { recursive: true });
      await writeFile(join(staging, 'src/settings.yml'), YAML.stringify({ id: 510867, name: 'Keep this name', custom_fields: [] }));
    } else {
      assert.equal(args[0], 'lint');
      const merged = YAML.parse(await readFile(join(cwd, 'src/settings.yml'), 'utf8'));
      assert.equal(merged.id, 510867);
      assert.equal(merged.name, 'Keep this name');
      assert.match(await readFile(join(cwd, 'src/transform.js'), 'utf8'), /function run/);
    }
  } });
  assert.deepEqual(calls.map(args => args[0]), ['clone', 'lint']);
  await assert.rejects(access(staging));
});

test('upload explicitly addresses the same plugin ID and cleans up its temporary export', async () => {
  const calls = [];
  let staging;
  await deploy({ yes: true, runner: async (args, cwd) => {
    calls.push(args);
    if (args[0] === 'clone') {
      staging = join(cwd, args[2]);
      await mkdir(join(staging, 'src'), { recursive: true });
      await writeFile(join(staging, 'src/settings.yml'), YAML.stringify({ id: 510867, custom_fields: [], oauth_pkce_enabled: 'true' }));
    }
  } });
  assert.deepEqual(calls.at(-1), ['push', '--id', '510867', '--force']);
  await assert.rejects(access(staging));
});

test('a mismatched server export is never uploaded', async () => {
  const calls = [];
  let staging;
  await assert.rejects(deploy({ yes: true, runner: async (args, cwd) => {
    calls.push(args[0]);
    staging = join(cwd, args[2]);
    await mkdir(join(staging, 'src'), { recursive: true });
    await writeFile(join(staging, 'src/settings.yml'), YAML.stringify({ id: 123 }));
  } }), /does not match/);
  assert.deepEqual(calls, ['clone']);
  await assert.rejects(access(staging));
});

test('official trmnlp config, launcher and CI workflow target the existing instance', async () => {
  const config = YAML.parse(await readFile(join(projectRoot, '.trmnlp.yml'), 'utf8'));
  assert.ok(config.watch.includes('src'));
  assert.equal(config.transform_runtime, 'enabled');
  assert.match(await readFile(join(projectRoot, 'bin/trmnlp'), 'utf8'), /IMAGE=trmnl\/trmnlp:v0\.31\.1/);
  const workflow = YAML.parse(await readFile(join(projectRoot, '.github/workflows/trmnl.yml'), 'utf8'));
  assert.ok(workflow.on.workflow_dispatch === null);
  assert.deepEqual(workflow.jobs.deploy.needs, 'check');
  assert.ok(workflow.jobs.deploy.steps.some(step => step.run === 'node auxiliary/deploy.mjs --yes'));
});
