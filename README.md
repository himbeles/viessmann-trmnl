# Viessmann heat pump for TRMNL X

A read-only TRMNL private plugin showing supply, hot-water and outdoor temperatures, heating-curve parameters and the configured operating mode. The full-screen layout plots a nonlinear E3 heating curve with six labelled outdoor-temperature points and the configured supply-temperature limit. Compact layouts show temperatures, targets and a prominent operating mode.

The display defaults to **English**. Choose **Deutsch** in **Display language** for German labels, status messages, number formatting and timestamps.

## Requirements

- A TRMNL account with private-plugin access, such as the Developer add-on or a BYOD license.
- A heat pump connected to ViCare and a Viessmann developer application with an OAuth Client ID and access to the required API features.
- Your API installation ID, gateway serial number and device ID. These differ from the OAuth Client ID; the heat pump's serial number is not necessarily the gateway serial number.

Feature availability depends on the device and API permissions. The initial mappings are candidates to verify against your device's feature response.

## Install

1. Clone or download this repository.
2. From the repository directory, package the plugin with Python 3:

   ```sh
   python auxiliary/package.py
   ```

3. In TRMNL, open **Plugins → Private Plugin → Import new** and select `auxiliary/output/viessmann-trmnl-import.zip`.
4. Open the imported plugin's settings and complete the configuration below.

The packager includes `settings.yml`, the four Liquid layouts and `transform.js`, without a parent folder. The transform runs in TRMNL's Serverless Node runtime to reduce the large Viessmann response before storage and rendering. Do not import GitHub's repository ZIP directly. You can also ZIP these six files manually; Node.js is not needed on your own computer to install or run the plugin.

## Configure the API connection

1. Enter **API installation ID**, **API gateway serial number** and **API device ID** from your Viessmann API inventory. See the [API inventory guide](auxiliary/README.md#optional-api-inventory-helper) for the endpoints and optional debugging helper.
2. In the plugin's OAuth settings, enter your Viessmann application's **Client ID**. Leave the Client Secret empty for a public PKCE client; follow your application's registration requirements for other client types.
3. Copy the exact **OAuth Redirect URL displayed by your TRMNL plugin** into the Viessmann application's allowed redirect URIs.
4. Check the imported OAuth settings:

   | Setting | Value |
   |---|---|
   | Authorization URL | `https://iam.viessmann-climatesolutions.com/idp/v3/authorize` |
   | Token URL | `https://iam.viessmann-climatesolutions.com/idp/v3/token` |
   | Scopes | `IoT User offline_access` |
   | PKCE | Enabled, S256 |
   | Scope separator | Space |
   | Token authentication / body format | body / form |

5. Connect through TRMNL and authorize with Viessmann. Keep tokens in TRMNL's OAuth configuration, outside markup and Static Data.
6. Save and select **Force Refresh**. Under **Edit Markup → Your Variables**, check the API response and compare the displayed readings with ViCare.
7. Add the plugin to your playlist and select the desired full-screen or compact layout.

Check **Enable PKCE? → Yes** in the saved TRMNL settings, even after importing. If authorization reports **code challenge required**, enable PKCE, save, and start a new connection from TRMNL instead of refreshing the old authorization page.

The plugin uses **Polling**, **GET**, and `Authorization: Bearer {{ oauth_access_token }}`. The default refresh interval is **60 minutes**, not seconds. No Home Assistant or additional server is required by this design. Live OAuth, token renewal and physical device rendering still need verification with your account.

## Configuration fields

| Field | Default | Purpose |
|---|---|---|
| Display language | English (`en`) | Choose English or German (`de`). |
| Display time zone | `Europe/Berlin` | IANA time zone; daylight-saving time is handled automatically. |
| API installation ID | Required | Installation identifier from the API inventory. |
| API gateway serial number | Required | Gateway identifier from the API inventory. |
| API device ID | `0` | Confirm against the API device list; `0` is the verified heating device for the supplied Vitocal inventory. |
| Heating circuit | `0` | First API heating circuit; select another index if needed. |
| API feature: supply temperature | `heating.secondaryCircuit.sensors.temperature.supply` | Feature used for the supply reading. |
| API feature: hot-water cylinder temperature | `heating.dhw.sensors.temperature.dhwCylinder` | Feature used for the cylinder reading. |
| API feature: outdoor temperature | `heating.sensors.temperature.outside` | Feature used for the outdoor reading. |
| Mark readings stale after (minutes) | `120` | Age threshold for the oldest valid temperature sensor timestamp; configuration timestamps are excluded. |
| API feature: supply setpoint | Blank | Optional direct supply-target feature. If unavailable, the target is calculated and labelled accordingly. |
| API feature: configured hot-water target | `heating.dhw.temperature.main` | Configured main hot-water target; not necessarily the active scheduled target. |
| Maximum supply temperature (fallback, °C) | Blank | Used only when the API does not expose the circuit maximum; API values take precedence. |
| Heating curve reference points | Blank | Optional JSON reference pairs that override the dynamic model. Leave blank for live calculation. |

The heating circuit selects `heating.circuits.N.heating.curve` for slope/offset and `heating.circuits.N.operating.modes.active` for operating mode. An operating mode is not a compressor-running indicator.

## Troubleshooting and display limits

- **Large payload / impaired plugin:** install the Serverless transform using the steps below. Resetting status alone does not reduce the response.
- **No readings:** check OAuth, installation/gateway/device identifiers and the response under **Your Variables**.
- **One reading is missing:** verify its feature name, `isEnabled` state and API availability. Missing or failed readings display a dash; they are not treated as zero.
- **HTTP 401 / 403 / 429:** reconnect for authentication errors, check permissions for access errors, or wait for the API quota to reset.
- **Redirect error:** compare the registered URI with the exact callback URL shown by your plugin.
- **Stale or unknown timestamp:** check the sensor timestamp in your configured time zone. An offline E-Ink screen retains its last image and cannot update its stale badge until another screen is rendered.

## Curve, targets and timestamps

The graph is recalculated on each refresh from the API's slope, offset, selected room setpoint, and circuit supply-temperature limits. It uses the nonlinear E3 calculation implemented by PyViCare for E3 heat pumps (matching the supplied Vitocal 250-A device roles), rather than the previous linear schema. All six reference temperatures are shown: **−30, −20, −10, 0, 10 and 20 °C**. Intermediate points draw the curve smoothly; minimum/maximum limits produce plateaus instead of clipping the chart. A dashed line identifies the maximum.

The API features used here expose parameters, not a directly sampled ViCare curve. Values are therefore labelled **calculated** and should be compared with the app; firmware-specific control and filtered outdoor temperatures can cause differences. Room target comes from the active heating program, with a normal-program fallback for plotting. The curve is unavailable if no room target is supplied. There is no assumed 20 °C room target.

The circuit maximum is read from `heating.circuits.N.temperature.levels.properties.max.value`, with its minimum applied when available. If the maximum is unavailable, the chart says **Limit unavailable**. You can enter the device's current maximum in the fallback field (the supplied screenshot showed 50 °C); it is labelled as configuration and is overridden when the API provides a maximum. Do not use an API command's allowed input range as the configured maximum.

Heating and hot-water tiles include target values. A configured supply-target feature is preferred; otherwise a model-derived target at the current outdoor reading is explicitly labelled **calculated**. The hot-water target is the configured main setting, which can differ from a scheduled second temperature. The full layout also shows the active room target. The plugin never changes heat-pump settings.

**Why “Daten veraltet” appeared:** the previous implementation used the oldest timestamp across sensors, curve settings and mode. An unchanged curve or mode could therefore make the dashboard appear stale. Freshness now uses only valid supply, hot-water and outdoor sensor timestamps. Changing the time zone affects presentation, not age. A sensor's own API timestamp may still describe its last change rather than a new sample; an old timestamp alone does not prove the device is disconnected. Missing sensor timestamps are identified separately.

Local time defaults to **Europe/Berlin**, including winter/summer transitions. Choose another IANA zone in **Display time zone**. Invalid zones fall back to UTC.

### Updating an existing connected plugin

1. Replace the Serverless code with the latest [`transform.js`](transform.js), keeping **Node** selected.
2. Replace the four layout tabs with the corresponding `.liquid` files from this repository.
3. Copy the `custom_fields` section from [`settings.yml`](settings.yml) into the plugin's Form Fields definition; retain existing field values and OAuth settings.
4. Save, set your time zone, then **Force Refresh**. If the plugin is impaired, reset its status first.

Keep `curve_points` blank for dynamic calculation. The [auxiliary guide](auxiliary/README.md#heating-curve-and-data-age) documents the model and optional reference-point override.

## Upgrade an existing plugin for large API responses

The full Viessmann feature list can exceed TRMNL's 100 KB polling limit. The included Serverless transform removes unrelated features, command definitions and unused metadata. It makes no additional API requests and preserves sensor timestamps, language and custom feature mappings.

To update an already connected plugin without creating another instance:

1. In TRMNL, open the existing plugin → **Edit Markup → Serverless**.
2. Select **Node** and paste the complete contents of [`transform.js`](transform.js).
3. Save the code and verify that **Serverless Language** in the plugin settings is **Node**.
4. Keep your existing polling URL, identifiers, OAuth connection and PKCE setting.
5. Select **Reset status** (German: **Status zurücksetzen**) to clear the impaired state, then **Force Refresh**.
6. Check **Your Variables** and the rendered temperatures. If it fails, enable Debug Logs and inspect the Serverless error; avoid sharing tokens or the full raw response.

New imports include the transform and `serverless_language: node`. Verify the Serverless tab contains the script after importing. If it is empty, paste `transform.js` manually using the same steps. The transform has been tested locally with oversized synthetic responses; the hosted run still requires verification in your TRMNL account.

See [auxiliary documentation](auxiliary/README.md) for detailed feature mapping, API debugging, local previews and development commands. The [official TRMNL import guide](https://help.trmnl.com/en/articles/10542599-importing-and-exporting-private-plugins) describes the flat plugin ZIP format.

Serverless references: [TRMNL Serverless setup](https://help.trmnl.com/en/articles/14130649-serverless) and [official CLI transform-file support](https://github.com/usetrmnl/trmnlp#serverless-transforms).
