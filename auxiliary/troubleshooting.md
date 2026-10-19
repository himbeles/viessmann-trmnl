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

### Get a Client ID and register redirects

1. Open the [Viessmann Developer Portal](https://app.developer.viessmann-climatesolutions.com/) and sign in with the same account that owns the installation in ViCare.
2. In **My Dashboard → Your clients**, use **+ Add** to create a public client, or edit an existing one. Copy the **Client ID**. Use PKCE; the plugin does not require a Client Secret.
3. In that client's redirect URI settings, register the exact OAuth Redirect URL shown in your TRMNL plugin settings. This is the callback for the hosted plugin.
4. For the discovery helper, also register **`http://localhost:51125`**, without a trailing slash. Keep the TRMNL redirect registered. If you use a separate developer client for local tools, pass that client's ID to the helper and keep the hosted client's ID in TRMNL.

The Client ID identifies the developer application. It is different from the installation ID and from the TRMNL API key used for publishing.

### Run inventory discovery

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and run commands from the repository root. Both helpers declare their Python version and dependencies using [inline script metadata](https://docs.astral.sh/uv/guides/scripts/#declaring-script-dependencies). Always use `uv run --script`; no virtual environment or manual dependency installation is needed.

On your local computer with a browser:

```sh
uv run --script auxiliary/inspect_api.py --client-id YOUR_CLIENT_ID
```

PyViCare opens Viessmann's browser sign-in and handles OAuth with PKCE. Complete sign-in within three minutes. The callback uses local port **51125**, which must be free. The helper keeps tokens in memory, does not save or print them, and does not change the hosted plugin's OAuth connection. Each invocation requires sign-in again.

The helper requests:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/equipment/installations?includeGateways=true
```

Example helper output (illustrative IDs):

```json
{
  "installations": [
    {
      "id": 1234567,
      "gateways": [
        {
          "serial": "7000000000000001",
          "devices": [
            {"id": "0", "modelId": "Example heat pump", "deviceType": "heating"}
          ]
        }
      ]
    }
  ]
}
```

| TRMNL custom field | Value in helper output | Example |
|---|---|---|
| `installation_id` | `installations[].id` | `1234567` |
| `gateway_serial` | The selected installation's `gateways[].serial` | `7000000000000001` |
| `device_id` | That gateway's heating-device `devices[].id` | `0` |

Keep all three values from the same installation/gateway/device branch. If there are multiple devices, use the model and type to select the heat pump rather than a gateway or unrelated accessory. Verify its features with the next command if needed. The ViCare device number and indoor-unit serial are not substitutes for these identifiers.

The raw API response uses `data[]` where the helper prints `installations[]`; gateway and device nesting are the same.

### Inspect device features

To inspect temperature, curve, operating-mode, electricity, and heat features, replace each placeholder with the values from the inventory:

```sh
uv run --script auxiliary/inspect_api.py --client-id YOUR_CLIENT_ID \
  --installation INSTALLATION --gateway GATEWAY --device DEVICE
```

All three device-selection flags are required together. The request is:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/features/installations/INSTALLATION/gateways/GATEWAY/devices/DEVICE/features/
Authorization: Bearer <access-token>
```

For a headless computer, or if you already have a valid Viessmann OAuth access token, omit `--client-id`:

```sh
uv run --script auxiliary/inspect_api.py
```

The helper prompts privately for the token. The same token-prompt mode works with the three device-selection flags. It does not refresh an expired token; obtain a new one through your existing OAuth client or use browser sign-in locally.

API discovery uses GET requests only and filters feature output to `feature`, `isEnabled`, `timestamp`, and `properties`. Its feature filter is limited to the listed families; it is not a complete inventory of every component-state feature. Inventory output includes device identifiers, so redact those before sharing it. Each invocation consumes API quota and has no automatic retry.

## Verify live polling

The polling verification script targets the existing plugin **510867**. It requires a TRMNL account API key in `TRMNL_API_KEY` and has no third-party Python dependencies. Run it with uv:

```sh
uv run --script auxiliary/refresh.py
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
uv run --script auxiliary/refresh.py --debug
```

Inspect those request logs privately in TRMNL. For test reports and deployment logs, see [GitHub Actions](development.md#github-actions).
