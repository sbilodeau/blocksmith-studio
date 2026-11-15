# Releasing Blocksmith Studio

Releases are built by GitHub Actions and published on
[GitHub Releases](https://github.com/sbilodeau/blocksmith-studio/releases). Installed apps check that page
for updates.

## Cutting a release

1. Make sure the commit you want to ship is on `main` and CI is green.
2. On GitHub, open **Actions > Release > Run workflow**.
3. Pick the branch (normally `main`), optionally type extra **notes** (Markdown), and click **Run workflow**.

The workflow (`.github/workflows/release.yml`) then:

| Job       | Runner                       | What it does                                                                                |
| --------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `version` | ubuntu                       | Computes the next version with `node scripts/calver.mjs` from the existing `v*` tags        |
| `test`    | ubuntu                       | `npm ci`, lint, typecheck, `npm test`                                                       |
| `build`   | windows-latest, macos-latest | Writes the version into `package.json` (not committed), builds, packages, uploads the files |
| `publish` | ubuntu                       | Creates tag `v<version>` on the workflow commit and the GitHub Release with all the files   |

Only one release runs at a time. The version is never committed back: the git tag is the source of truth.
The release notes are GitHub's generated notes (merged PRs since the previous tag), with the optional notes
from the form shown above them.

To check which version the next release will get, run `npm run calver` locally (after `git fetch --tags`).

## Versioning (CalVer)

Versions look like `YY.W.FIX`, for example `26.46.0`:

| Part  | Meaning                                                                     |
| ----- | --------------------------------------------------------------------------- |
| `YY`  | ISO week-year, 2 digits                                                     |
| `W`   | ISO week number (1-53), no leading zero                                     |
| `FIX` | Releases already tagged in that ISO week (first release of the week is `0`) |

- No leading zeros, so every version is valid semver (required by electron-updater): week 3 of 2027 is `27.3.0`.
- The ISO week-year is used, so versions keep increasing across new year: 2027-01-01 is a Friday in ISO week 53
  of 2026, so it releases as `26.53.x`.
- Dates are taken in UTC (the release runner's clock).
- If a tag was deleted and the FIX numbers have a gap, the next FIX is `highest + 1` so it never reuses a tag.

The logic lives in `scripts/lib/calver.mjs` (unit-tested in `tests/unit/calver.test.ts`). The CLI accepts
`--date YYYY-MM-DD` to preview the version for another day: `node scripts/calver.mjs --date 2027-01-01`.

## Release artifacts

Artifact names never contain spaces: GitHub turns spaces in asset names into dots, which would break the
URLs in the update metadata.

| File                                       | Platform            | Purpose                                                   |
| ------------------------------------------ | ------------------- | --------------------------------------------------------- |
| `Blocksmith-Studio-<v>-setup.exe`          | Windows x64         | NSIS installer (choose folder, desktop shortcut)          |
| `Blocksmith-Studio-<v>-setup.exe.blockmap` | Windows x64         | Differential update data                                  |
| `latest.yml`                               | Windows             | Update metadata read by electron-updater                  |
| `Blocksmith-Studio-<v>-arm64.dmg`          | macOS Apple Silicon | Disk image to install the app                             |
| `Blocksmith-Studio-<v>-x64.dmg`            | macOS Intel         | Disk image to install the app                             |
| `Blocksmith-Studio-<v>-arm64.zip`          | macOS Apple Silicon | Zipped app (used by electron-updater once signing exists) |
| `Blocksmith-Studio-<v>-x64.zip`            | macOS Intel         | Zipped app (used by electron-updater once signing exists) |
| `*.dmg.blockmap`, `*.zip.blockmap`         | macOS               | Differential update data                                  |
| `latest-mac.yml`                           | macOS               | Update metadata for both architectures                    |

The macOS DMGs and ZIPs for both architectures are built in a single job so that one `latest-mac.yml`
lists all of them. The build job fails if a metadata file references a file that was not produced.

To build locally (unsigned, nothing published): `npm run package:dir` (unpacked app in `dist/`),
`npm run package:win` or `npm run package:mac`.

## How updates work

The app checks GitHub Releases about 10 seconds after startup and then every 6 hours. This can be turned off
in **Settings** (`updates.autoCheck`). Updates are disabled when running from source (`npm run dev`).
The logic is in `src/main/services/updater.ts`.

| Platform | Mode     | Flow                                                                                                                            |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `auto`   | electron-updater reads `latest.yml`, downloads the new installer when you accept, and installs it on restart (or when you quit) |
| macOS    | `manual` | electron-updater only reads `latest-mac.yml`; the app downloads the DMG for your Mac (arm64 or x64) to Downloads and opens it   |

Why macOS is manual: Squirrel.Mac, which electron-updater uses on macOS, refuses to install updates for apps
that are not signed with an Apple Developer ID. On macOS, after the DMG opens, drag **Blocksmith Studio** onto
**Applications** and replace the old copy.

The macOS DMG URL is
`https://github.com/sbilodeau/blocksmith-studio/releases/download/v<v>/Blocksmith-Studio-<v>-<arch>.dmg`.
If you change `artifactName` in `electron-builder.yml`, update `macDmgFileName()` in the updater too.

## First launch of an unsigned build

The builds are not code-signed yet, so the operating system warns on first launch.

**macOS (Gatekeeper)**: the app is ad-hoc signed (required to run on Apple Silicon) but not notarized.

- In Finder, right-click (or Control-click) **Blocksmith Studio** in Applications, choose **Open**, then **Open**
  again in the dialog. On recent macOS versions, if there is no **Open** button, go to
  **System Settings > Privacy & Security** and click **Open Anyway**.
- Or remove the quarantine flag in Terminal:

  ```sh
  xattr -dr com.apple.quarantine "/Applications/Blocksmith Studio.app"
  ```

This is needed after each manual update too, since each DMG is downloaded again.

**Windows (SmartScreen)**: if "Windows protected your PC" appears, click **More info**, then **Run anyway**.

## Adding code signing later

Only CI secrets and a few config lines change; the pipeline stays the same.

### Windows

1. Get a code signing certificate (or use Azure Trusted Signing, see `win.azureSignOptions` in the
   electron-builder docs).
2. Add repository secrets `CSC_LINK` (base64 of the `.pfx`, or an HTTPS link) and `CSC_KEY_PASSWORD`
   (use `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` if macOS uses a different certificate).
3. Pass them as `env` to the **Package** step of the Windows build in `release.yml`.
4. Optionally set `win.signtoolOptions.publisherName` so electron-updater verifies the installer signature.

### macOS

1. Join the Apple Developer Program and export a **Developer ID Application** certificate as `.p12`.
2. Add repository secrets: `CSC_LINK` (base64 of the `.p12`), `CSC_KEY_PASSWORD`, and for notarization
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (or `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
   `APPLE_API_ISSUER`).
3. In `electron-builder.yml` (`mac` section): remove `identity: '-'`, set `hardenedRuntime: true` and
   `notarize: true`.
4. In `release.yml`: remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the build job and pass the secrets as
   `env` to the **Package** step of the macOS build.
5. In `src/main/services/updater.ts`, use `auto` mode on macOS too, so electron-updater downloads the ZIP
   and installs silently like on Windows.
