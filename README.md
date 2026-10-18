# Viessmann heat pump for TRMNL X

A read-only TRMNL private plugin showing supply, hot-water and outdoor temperatures, heating-curve parameters and the configured operating mode. The full-screen layout includes a schematic heating curve; compact layouts show temperatures.

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
| API installation ID | Required | Installation identifier from the API inventory. |
| API gateway serial number | Required | Gateway identifier from the API inventory. |
| API device ID | `0` | Confirm against the API device list; `0` is the verified heating device for the supplied Vitocal inventory. |
| Heating circuit | `0` | First API heating circuit; select another index if needed. |
| API feature: supply temperature | `heating.secondaryCircuit.sensors.temperature.supply` | Feature used for the supply reading. |
| API feature: hot-water cylinder temperature | `heating.dhw.sensors.temperature.dhwCylinder` | Feature used for the cylinder reading. |
| API feature: outdoor temperature | `heating.sensors.temperature.outside` | Feature used for the outdoor reading. |
| Mark readings stale after (minutes) | `120` | Age threshold based on the oldest displayed API timestamp. |

The heating circuit selects `heating.circuits.N.heating.curve` for slope/offset and `heating.circuits.N.operating.modes.active` for operating mode. An operating mode is not a compressor-running indicator.

## Troubleshooting and display limits

- **Large payload / impaired plugin:** install the Serverless transform using the steps below. Resetting status alone does not reduce the response.
- **No readings:** check OAuth, installation/gateway/device identifiers and the response under **Your Variables**.
- **One reading is missing:** verify its feature name, `isEnabled` state and API availability. Missing or failed readings display a dash; they are not treated as zero.
- **HTTP 401 / 403 / 429:** reconnect for authentication errors, check permissions for access errors, or wait for the API quota to reset.
- **Redirect error:** compare the registered URI with the exact callback URL shown by your plugin.
- **Stale or unknown timestamp:** check the displayed UTC timestamp. An offline E-Ink screen retains its last image and cannot update its stale badge until another screen is rendered.

The heating curve is explicitly **schematic**, not a calculation of Viessmann setpoints. It does not simulate model-specific control or supply-temperature limits. The plugin never changes heat-pump settings.

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
