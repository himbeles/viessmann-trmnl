import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(projectRoot, 'src');
const files = ['full.liquid', 'half_horizontal.liquid', 'half_vertical.liquid', 'quadrant.liquid', 'transform.js'];

// Work from the installed instance's export. Credentials, instance values, polling
// configuration and OAuth provider settings are not replaced by repository defaults.
export function mergeSettings(template, installed, expectedId) {
  if (!Number.isSafeInteger(expectedId) || expectedId <= 0 || Number(installed?.id) !== expectedId) {
    throw new Error('The installed plugin ID does not match the configured target; refusing to create or update another instance.');
  }
  function fields(value) {
    const result = typeof value === 'string' ? YAML.parse(value) : value;
    if (result == null) return [];
    if (!Array.isArray(result) || result.some(field => !field || typeof field.keyname !== 'string')) {
      throw new Error('Unexpected custom-fields format; no settings have been uploaded.');
    }
    return result;
  }
  const definitions = new Map(fields(installed.custom_fields).map(field => [field.keyname, field]));
  for (const field of fields(template.custom_fields)) {
    const previous = definitions.get(field.keyname);
    definitions.set(field.keyname, {
      ...previous, ...field,
      // Exported instances can encode a configured default in the field definition.
      ...(previous && Object.hasOwn(previous, 'default') ? { default: previous.default } : {})
    });
  }
  // TRMNL exports can omit sensitive polling headers. Re-importing the empty
  // value removes authentication. Restore only our public OAuth token template;
  // actual credentials and tokens continue to live on the installed instance.
  const pollingHeaders = typeof installed.polling_headers === 'string' && installed.polling_headers.trim()
    ? installed.polling_headers : template.polling_headers;
  if (!pollingHeaders) throw new Error('No polling authentication header is available; refusing to upload.');
  return { ...installed, id: expectedId, polling_headers: pollingHeaders,
    // Hosted TRMNL's PKCE selector stores yes/no; the local gem documents true/false.
    oauth_enabled: 'yes', oauth_pkce_enabled: 'yes',
    serverless_language: 'node', custom_fields: [...definitions.values()] };
}

function command(args, cwd) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(join(projectRoot, 'bin/trmnlp'), args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveCommand() : reject(new Error(`trmnlp ${args[0]} failed (exit ${code}).`)));
  });
}

export async function deploy({ yes = false, runner = command } = {}) {
  const template = YAML.parse(await readFile(join(sourceRoot, 'settings.yml'), 'utf8'));
  const id = template.id;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Set the existing numeric plugin ID in src/settings.yml before updating.');
  const staging = await mkdtemp(join(projectRoot, '.trmnlp-deploy-'));
  try {
    const checkout = join(staging, 'plugin');
    await runner(['clone', '--skip-git', relative(projectRoot, checkout), String(id)], projectRoot);
    const installed = YAML.parse(await readFile(join(checkout, 'src/settings.yml'), 'utf8'));
    const merged = mergeSettings(template, installed, id);
    await mkdir(join(checkout, 'src'), { recursive: true });
    for (const file of files) await cp(join(sourceRoot, file), join(checkout, 'src', file));
    for (const ext of ['py', 'rb', 'php']) await rm(join(checkout, 'src', `transform.${ext}`), { force: true });
    await cp(join(projectRoot, '.trmnlp.yml'), join(checkout, '.trmnlp.yml'));
    await writeFile(join(checkout, 'src/settings.yml'), YAML.stringify(merged));
    await runner(['lint'], checkout);
    console.log(`Prepared an update for existing plugin ${id}: layouts, Node transform and form definitions. Saved instance settings retained.`);
    if (!yes) {
      console.log('Dry run complete. Run with --yes to upload to this same plugin.');
      return;
    }
    await runner(['push', '--id', String(id), '--force'], checkout);
    console.log(`Updated https://trmnl.com/plugin_settings/${id}/edit`);
  } finally {
    // Temporary exports can contain private configuration and never enter Git.
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node auxiliary/deploy.mjs [--dry-run | --yes]\nAuthenticate once with ./bin/trmnlp login, or set TRMNL_API_KEY in the environment.');
  } else if (args.some(arg => !['--dry-run', '--yes'].includes(arg)) || (args.includes('--yes') && args.includes('--dry-run'))) {
    console.error('Usage: node auxiliary/deploy.mjs [--dry-run | --yes]');
    process.exitCode = 1;
  } else {
    await deploy({ yes: args.includes('--yes') }).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
