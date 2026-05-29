import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

import fs from "fs";
import path from "path";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

// When building for E2E tests, relax fuses so Playwright can connect
const isE2E = process.env.E2E === "1";
const devServerPort = Number.parseInt(
  process.env.LYCHEE_DEV_SERVER_PORT ?? "3001",
  10,
);

const entitlements = path.resolve(__dirname, "build", "entitlements.mac.plist");

// Sign + notarize only when an identity is present (skip for local dev/E2E builds).
const shouldSignMac = !isE2E && !!process.env.APPLE_TEAM_ID;

// --- Windows code signing via Azure Trusted Signing ---
// Enabled when the Azure account env vars are present (skip for dev/E2E). Auth
// is handled by the Azure dlib via DefaultAzureCredential, which reads
// AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET from the environment.
// Signing is Windows-only (signtool); on macOS/Linux these vars are simply unset.
const shouldSignWin =
  !isE2E &&
  !!process.env.AZURE_CODE_SIGNING_ACCOUNT &&
  !!process.env.AZURE_CODE_SIGNING_DLIB;

// signtool reads the account/profile/endpoint from this JSON (the /dmdf file).
// It is generated from env in the prePackage hook below, before any signing runs.
const winMetadata = path.resolve(__dirname, "build", "trusted-signing.json");

// Built once and reused by both the packager (signs the app's nested binaries)
// and MakerSquirrel (signs Setup.exe). NOTE: paths must not contain spaces —
// @electron/windows-sign space-splits signWithParams, so quoting won't help.
// Hash + timestamp server live in dedicated keys; duplicating them inside
// signWithParams makes signtool reject with duplicate-flag errors that the
// packager swallows.
const winSign = shouldSignWin
  ? {
      ...(process.env.SIGNTOOL_PATH
        ? { signToolPath: process.env.SIGNTOOL_PATH }
        : {}),
      signWithParams: `/v /debug /dlib ${process.env.AZURE_CODE_SIGNING_DLIB} /dmdf ${winMetadata}`,
      timestampServer:
        process.env.AZURE_TIMESTAMP_URL ?? "http://timestamp.acs.microsoft.com",
      hashes: ["sha256" as const],
    }
  : undefined;

// Write the Trusted Signing metadata file consumed by signtool's /dmdf flag.
function writeWinSignMetadata() {
  if (!shouldSignWin) return;
  fs.mkdirSync(path.dirname(winMetadata), { recursive: true });
  fs.writeFileSync(
    winMetadata,
    JSON.stringify(
      {
        Endpoint: process.env.AZURE_ENDPOINT,
        CodeSigningAccountName: process.env.AZURE_CODE_SIGNING_ACCOUNT,
        CertificateProfileName: process.env.AZURE_CERT_PROFILE,
      },
      null,
      2,
    ),
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: path.resolve(__dirname, "build", "icon"),
    ...(shouldSignMac
      ? {
          osxSign: {
            optionsForFile: () => ({
              entitlements,
              hardenedRuntime: true,
            }),
          },
          osxNotarize:
            process.env.APPLE_ID && process.env.APPLE_APP_PASSWORD
              ? {
                  appleId: process.env.APPLE_ID,
                  appleIdPassword: process.env.APPLE_APP_PASSWORD,
                  teamId: process.env.APPLE_TEAM_ID!,
                }
              : { keychainProfile: "lychee-notarize" },
        }
      : {}),
    // Recursively signs the packaged app's nested binaries (electron .exe,
    // native .node modules, etc.) before the installer is built.
    ...(winSign ? { windowsSign: winSign } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: path.resolve(__dirname, "build", "icon.ico"),
      iconUrl:
        "https://raw.githubusercontent.com/reddpy/lychee/main/build/icon.ico",
      // Signs the generated Setup.exe (and nupkg contents).
      ...(winSign ? { windowsSign: winSign } : {}),
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({
      title: "Install Lychee",
      background: path.resolve(__dirname, "build", "dmg-background.png"),
      icon: path.resolve(__dirname, "build", "icon.icns"),
      iconSize: 120,
      contents: (opts: { appPath: string }) => [
        { x: 140, y: 200, type: "file", path: opts.appPath },
        { x: 400, y: 200, type: "link", path: "/Applications" },
      ],
      additionalDMGOptions: {
        window: {
          size: { width: 540, height: 360 },
        },
      },
    }),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      port: Number.isNaN(devServerPort) ? 3001 : devServerPort,
      devContentSecurityPolicy:
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: https: http: lychee-image:; connect-src 'self' ws:; frame-src 'none'",
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/index.html",
            js: "./src/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/preload.ts",
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: isE2E,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: !isE2E,
      [FuseV1Options.OnlyLoadAppFromAsar]: !isE2E,
    }),
  ],
  hooks: {
    // Generate the Azure Trusted Signing metadata file before packaging so it
    // exists when signtool runs (no-op unless Windows signing env is present).
    prePackage: async () => {
      writeWinSignMetadata();
    },
  },
};

export default config;
