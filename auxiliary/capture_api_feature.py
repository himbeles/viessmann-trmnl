# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Capture the full electricity-total feature without exposing authentication data."""
import json
from pathlib import Path
import sys
import time
from urllib.parse import quote

from refresh import request

FEATURE = 'heating.power.consumption.total'


def find_feature(value, depth=0):
    """Search structured variables and JSON embedded in TRMNL log messages."""
    if depth > 20:
        return None
    if isinstance(value, dict):
        if value.get('feature') == FEATURE and isinstance(value.get('properties', {}).get('day', {}).get('value'), list):
            return value
        children = value.values()
    elif isinstance(value, list):
        children = value
    elif isinstance(value, str):
        decoder = json.JSONDecoder()
        # A log line can prefix an object, or contain a JSON-encoded body string.
        for offset, char in enumerate(value):
            if char not in '{["':
                continue
            try:
                decoded, _ = decoder.raw_decode(value, offset)
            except ValueError:
                continue
            if decoded == value:
                continue
            found = find_feature(decoded, depth + 1)
            if found:
                return found
        return None
    else:
        return None
    for child in children:
        found = find_feature(child, depth + 1)
        if found:
            return found
    return None


def main():
    # Debug logs contain request credentials: never print or persist whole logs.
    request('/debug_logs', 'POST')
    result = request('/refreshes', 'POST')
    job = result.get('job_id')
    if not job:
        raise RuntimeError('TRMNL did not start a polling refresh.')
    for _ in range(20):
        result = request('/refreshes/' + quote(str(job), safe=''))
        if result.get('status') == 'complete':
            break
        time.sleep(3)
    if result.get('status') != 'complete' or result.get('success') is not True:
        raise RuntimeError('Polling did not complete successfully.')
    feature = find_feature(result.get('variables', {})) or find_feature(result.get('logs', []))
    if feature is None:
        # The log store can briefly lag behind the polling job.
        for _ in range(4):
            feature = find_feature(request('/logs?level=debug&limit=50').get('logs', []))
            if feature is not None:
                break
            time.sleep(3)
    if feature is None:
        raise RuntimeError('Full feature was not present in refresh variables or request logs. No partial response was saved.')
    output = Path('api-inspection')
    output.mkdir(exist_ok=True)
    target = output / 'electricity-total.json'
    target.write_text(json.dumps(feature, indent=2, ensure_ascii=False) + '\n')
    print(f'Saved {FEATURE} with {len(feature["properties"]["day"]["value"])} daily entries to {target}.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # HTTP/log parsing exceptions can embed authenticated request data.
        print('Feature capture failed; no credentials or raw logs have been printed.', file=sys.stderr)
        sys.exit(1)
