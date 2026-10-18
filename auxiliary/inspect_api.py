"""Read-only discovery. Token is entered privately and never printed or saved."""
import argparse
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.viessmann-climatesolutions.com/iot/v2'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installation')
    parser.add_argument('--gateway')
    parser.add_argument('--device')
    args = parser.parse_args()
    ids = [args.installation, args.gateway, args.device]
    if any(x is not None for x in ids) and not all(x is not None for x in ids):
        parser.error('Provide --installation, --gateway and --device together')
    token = getpass.getpass('Viessmann access token (hidden): ').strip()
    if not token:
        parser.error('Access token is required')
    if args.installation is not None:
        installation, gateway, device = [urllib.parse.quote(x, safe='') for x in ids]
        path = f'/features/installations/{installation}/gateways/{gateway}/devices/{device}/features/'
    else:
        path = '/equipment/installations?includeGateways=true'
    request = urllib.request.Request(API + path, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        print(f'HTTP {exc.code}: Check authentication, permissions or rate limits.', file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError, ValueError):
        print('API request failed. Check the network or response format.', file=sys.stderr)
        return 1
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
        print('Unexpected API format: data array is missing.', file=sys.stderr)
        return 1
    if args.installation is not None:
        selected = []
        for feature in payload['data']:
            name = feature.get('feature', '')
            if any(part in name for part in ('temperature', 'heating.curve', 'operating.modes.active', 'power.consumption', 'heat.production')):
                # Exclude commands, links, addresses, OAuth data and device identifiers.
                selected.append({k: feature[k] for k in ('feature', 'isEnabled', 'timestamp', 'properties') if k in feature})
        result = {'data': selected}
    else:
        result = {'installations': [
            {'id': item.get('id'), 'gateways': [
                {'serial': gateway.get('serial'), 'devices': [
                    {key: device.get(key) for key in ('id', 'modelId', 'deviceType')}
                    for device in gateway.get('devices', [])]}
                for gateway in item.get('gateways', [])]}
            for item in payload['data']]}
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
