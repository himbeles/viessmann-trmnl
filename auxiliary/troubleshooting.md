# Troubleshooting and API debugging

Start with the hosted plugin's **Force Refresh** and health status. A local preview uses sample data and does not verify the live OAuth connection.

## Authentication and HTTP errors

| Symptom | Check |
|---|---|
| HTTP 401 | OAuth Authentication and PKCE must be enabled. Reconnect the Viessmann account if the token is invalid. Confirm the polling header uses `oauth_access_token`. |
| Code challenge required | Enable PKCE and authorize the account again. |
| HTTP 403 | Check the Viessmann application's scopes, account permissions, and API feature access. |
| HTTP 404 or empty device data | Verify the installation, gateway, and device IDs against the API inventory. |
| HTTP 429 | Allow the rate limit to recover and review other API clients using the account. |
| Payload over 100 KB | Ensure `transform.js` is uploaded and Serverless language is Node. Publish the complete `src/` definition. |

See the [OAuth configuration](configuration.md#oauth-provider-settings) for provider URLs and the required hosted YAML values. Do not change Client IDs or tokens to fix a missing sensor feature.

## Missing or mismatched readings

A dash means the required reading or status is unavailable. Check the relevant [sensor mapping](api-reference.md) or [energy source selection](api-energy-fields.md) and inspect the feature's enabled state, properties, units, and timestamps.

The displayed heating supply and target use the selected radiator circuit. A heat-pump secondary-circuit reading is not a substitute for that sensor. Check `circuit` when the expected heating sensor is absent.

An auxiliary heater's availability flag does not report whether it is running. Component status depends on the dedicated running-state, stage, or current-draw readings described in the [component reference](api-reference.md#component-states).

For an energy mismatch with ViCare, compare all relevant counters and their source scopes before changing an override. Check both the feature timestamp and `dayValueReadAt`: a new feature timestamp can accompany an old day-counter read time. Electricity and heat can update independently. Repeated requests or a TRMNL refresh do not force a device reread. A clock marker means an explicit read time exceeds the configured threshold; the absence of a marker does not prove every value is current.

The footer reports the newest displayed timestamp. For a display that has stopped rendering, inspect TRMNL health and the playlist; the E-Ink screen retains its last image while offline.

## Find installation, gateway, and device IDs

Use an existing Viessmann OAuth access token with the optional Python 3 helper:

```sh
python3 auxiliary/inspect_api.py
```

The script prompts privately for the token and requests:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/equipment/installations?includeGateways=true
```

It prints installation IDs, gateway serials, and device IDs/models/types. Select the heating device from that inventory. Use `data[].id`, `data[].gateways[].serial`, and `data[].gateways[].devices[].id` as the corresponding custom fields. The indoor-unit serial and the API gateway serial are different identifiers.

To inspect temperature, curve, operating-mode, electricity, and heat features for a device:

```sh
python3 auxiliary/inspect_api.py   --installation INSTALLATION --gateway GATEWAY --device DEVICE
```

All three flags are required together. The request is:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/features/installations/INSTALLATION/gateways/GATEWAY/devices/DEVICE/features/
Authorization: Bearer <access-token>
```

The helper uses GET requests only, never saves or prints the token, and filters feature output to `feature`, `isEnabled`, `timestamp`, and `properties`. It does not obtain or refresh tokens. Its feature filter is limited to the listed families; it is not a complete inventory of every component-state feature. Inventory output includes device identifiers, so redact those before sharing it.

Each invocation consumes API quota and has no automatic retry. The helper requires only Python's standard library.

## Verify live polling

The polling verification script targets the existing plugin **510867**. It requires a TRMNL account API key in `TRMNL_API_KEY` and uses Python's standard library:

```sh
python3 auxiliary/refresh.py
```

Set the key privately in your environment. The deployment workflow supplies it from the repository Actions secret. When targeting another plugin, update the script's `BASE` constant as well as the plugin ID in `settings.yml`.

The script:

1. Reads the plugin details and checks that saved OAuth Authentication and PKCE are enabled.
2. Resets plugin health and requests a real polling refresh.
3. Waits for the refresh job, then reads the health logs.
4. Requires a successful refresh, no transform warning, nonempty feature data, and a healthy/active state.

It logs selected temperatures, circuit activity, component states, pressure, daily comparisons and explicit read times, per-use electricity, selected electricity sources, and bounded electricity-counter diagnostics. It does not print credentials or the complete settings/feature payload and does not rewrite OAuth settings.

TRMNL can summarize arrays as `{_compacted, count, sample}` in API inspection responses. The helper accepts that representation when checking feature counts. Electricity diagnostics are keyed by feature name so all retained candidates remain inspectable.

To enable TRMNL's own request logging for 24 hours before the check:

```sh
python3 auxiliary/refresh.py --debug
```

Inspect those request logs privately in TRMNL. For test reports and deployment logs, see [GitHub Actions](development.md#github-actions).
