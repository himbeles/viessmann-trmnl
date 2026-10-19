# Local development and publishing

This is a [trmnlp](https://github.com/usetrmnl/trmnlp) project. The CLI version and official container image used by this repository are pinned to **0.31.1**.

## Project structure

```text
src/
  settings.yml              Plugin definition, custom fields, OAuth, and target ID
  shared.liquid             Shared templates, styles, and translations
  full.liquid               Full-screen layout
  half_horizontal.liquid    Horizontal mashup layout
  half_vertical.liquid      Vertical mashup layout
  quadrant.liquid           Quarter-screen layout
  transform.js              Node Serverless transform
.trmnlp.yml                  Local sample data and preview configuration
bin/trmnlp                  Repository CLI launcher
.github/workflows/trmnl.yml  Checks, publishing, and live polling verification
tests/plugin_spec.rb        Native transform and render tests
auxiliary/                  Documentation and optional debugging scripts
```

All four layouts render the shared `dashboard` template. The transform reduces the Viessmann response to dashboard data before TRMNL stores and renders it, keeping the payload below TRMNL's 100 KB limit. The published plugin consists of `src/`; local fixtures, tests, and auxiliary tools are not uploaded by `trmnlp push`.

## Install the CLI

Follow the [official installation instructions](https://github.com/usetrmnl/trmnlp#readme). For a local gem installation matching this repository:

```sh
gem install trmnl_preview --version 0.31.1
```

The gem runtime requires Ruby 4.0+ and Node 24 for the Node Serverless transform. The official Docker image includes the runtime and test dependencies. See the upstream instructions for browser/screenshot prerequisites when running the tests without Docker.

The commands below use an installed `trmnlp`. Run them from the repository root.

## Preview

```sh
trmnlp serve
```

Open **http://localhost:4567** and select **TRMNL X / v2**. The preview supports layout selection, live reloading, data inspection, and screenshots. Change `custom_fields.language` in `.trmnlp.yml` to `de` to preview German.

For Docker or Podman, run the official image directly:

```sh
docker run --rm -it   -p 127.0.0.1:4567:4567   -v "$PWD:/plugin"   trmnl/trmnlp:v0.31.1 serve --bind 0.0.0.0
```

For Podman, replace `docker` with `podman` and use `docker.io/trmnl/trmnlp:v0.31.1` as the image name. The container engine must be running.

`.trmnlp.yml` supplies synthetic data and an empty polling URL override, so this preview does not fetch live Viessmann data. Its readings are dated **2026-10-18**. When previewing at another date, daily counters may be unavailable; update the sample timestamps together when you need a current-day preview. The tests use a frozen clock.

## Build and check

```sh
trmnlp build
trmnlp lint
trmnlp test --report report
```

The build writes HTML to `_build/`. The test report is `report/index.html`, with rendered images in `report/images/`. Tests run the official Liquid engine and Node transform runner, covering all layouts and both languages, source selection, units, missing data, daily rollover, time zones, and explicit day-counter read-time markers.

The single ignored lint rule is `no_style_restyling_framework`, which permits the dashboard's typography and layout styles.

## Publish to an instance

Check `src/settings.yml` before publishing. Its `id` identifies the target instance. This repository targets **510867**. Keep that ID for updates to that instance. To create a different instance, omit the ID for the initial push and save the returned ID for future updates. The polling verification script also targets **510867**; update its `BASE` constant when deploying to another instance.

```sh
trmnlp login
trmnlp push
```

Configure installation IDs and Viessmann OAuth credentials in the hosted plugin settings, not in the repository. Updating the same instance retains those values.

For a manual import, create a flat archive of the published files:

```sh
zip -j viessmann-trmnl.zip src/*
```

Use TRMNL's [private-plugin importer](https://help.trmnl.com/en/articles/10542599-importing-and-exporting-private-plugins). If editing through the dashboard, update **Shared**, all four layouts, and **Serverless** together.

## GitHub Actions

Add a TRMNL account API key as the repository Actions secret `TRMNL_API_KEY`. The workflow uses it for `trmnlp push --force` and the polling verification helper. Viessmann credentials stay in TRMNL.

- Pull requests run lint and tests.
- Pushes to `main` run lint and tests, publish after both pass, and verify a real polling refresh.
- Test reports are uploaded as the `trmnlp-report` artifact.
- Manual workflow runs execute checks. The `update_snapshots` option rewrites and uploads test snapshots. Manual runs do not publish.

The live check is [auxiliary/refresh.py](refresh.py). Its behavior and output are described in [troubleshooting](troubleshooting.md#verify-live-polling).
