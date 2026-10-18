"""Reset instance health and verify a real poll, without logging private data."""
import json
import os
import re
import sys
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = 'https://trmnl.com/api/plugin_settings/510867'


def request(path, method='GET', data=None):
    req = Request(BASE + path, method=method, data=json.dumps(data).encode() if data is not None else None, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + os.environ['TRMNL_API_KEY'],
        'Accept': 'application/json',
        'User-Agent': 'viessmann-trmnl/health-check',
    })
    try:
        with urlopen(req, timeout=30) as response:
            body = response.read()
            return json.loads(body).get('data', {}) if body else {}
    except HTTPError as error:
        raise RuntimeError(f'TRMNL API returned HTTP {error.code}') from None


def main():
    if '--debug' in sys.argv:
        request('/debug_logs', 'POST')
    details = request('/details')
    settings = details.get('settings', {})
    if settings.get('oauth_enabled') != 'true' or settings.get('oauth_pkce_enabled') != 'yes':
        raise RuntimeError('Saved OAuth/PKCE settings are disabled; inspect the TRMNL settings page.')
    request('/health_resets', 'POST')
    print('Plugin health reset. Starting a real polling refresh.', flush=True)
    result = request('/refreshes', 'POST')
    job = result.get('job_id')
    if not job:
        raise RuntimeError('Expected a polling refresh job; received a render-only response.')
    for _ in range(20):
        result = request('/refreshes/' + quote(str(job), safe=''))
        if result.get('status') == 'complete':
            break
        time.sleep(3)
    variables = result.get('variables') or {}
    features = variables.get('data', variables.get('IDX_0', {}).get('data', [])) if isinstance(variables, dict) else []
    # TRMNL's API summarizes arrays as {_compacted, count, sample}; that is
    # an API response format, not an empty feature list on the dashboard.
    feature_count = len(features) if isinstance(features, list) else (
        features.get('count', 0) if isinstance(features, dict) and features.get('_compacted') else 0)
    # Only dashboard readings; never log raw settings, tokens or the full response.
    health = request('/logs?limit=1').get('health', {})
    print(json.dumps({
        'refresh_status': result.get('status'),
        'refresh_success': result.get('success'),
        'transform_warning_present': bool(result.get('warning')),
        'feature_count': feature_count,
        'dashboard_signals': {
            'active_circuit': variables.get('activity', {}).get('state'),
            'pressure_bar': variables.get('pressure', {}).get('bar'),
            'return_temperature_c': variables.get('return_reading', {}).get('value'),
            'return_scope': variables.get('return_reading', {}).get('scope'),
            'latest_reading': variables.get('freshness', {}).get('latest_reading'),
            'electricity_by_use': variables.get('energy', {}).get('by_use'),
            'supply_scope': variables.get('supply_scope'),
            'supply_temperature_c': variables.get('supply_reading', {}).get('value'),
            'supply_target_c': variables.get('setpoints', {}).get('supply'),
        },
        'health_state': health.get('state'),
        'error_retry_count': health.get('error_retry_count'),
        'last_refresh': health.get('last_refresh'),
        'error_http_codes': re.findall(r'HTTP\s+(\d{3})', str(health.get('error_message') or '') + json.dumps(result.get('logs', []))),
    }, indent=2), flush=True)
    if result.get('success') is not True or result.get('warning') or health.get('state') not in ('active', 'healthy') or not isinstance(feature_count, int) or feature_count <= 0:
        raise RuntimeError('Live polling verification failed. Inspect the plugin status on TRMNL.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
