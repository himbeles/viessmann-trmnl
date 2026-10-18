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


def request(path, method='GET'):
    req = Request(BASE + path, method=method, headers={
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
    health = request('/logs?limit=1').get('health', {})
    print(json.dumps({
        'refresh_status': result.get('status'),
        'refresh_success': result.get('success'),
        'transform_warning_present': bool(result.get('warning')),
        'feature_count': len(features) if isinstance(features, list) else 0,
        'health_state': health.get('state'),
        'error_retry_count': health.get('error_retry_count'),
        'last_refresh': health.get('last_refresh'),
        'error_http_codes': re.findall(r'HTTP\s+(\d{3})', str(health.get('error_message') or '') + json.dumps(result.get('logs', []))),
    }, indent=2), flush=True)
    if result.get('success') is not True or result.get('warning') or health.get('state') != 'active':
        raise RuntimeError('Live polling verification failed. Inspect the plugin status on TRMNL.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
