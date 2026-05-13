#!/usr/bin/env node
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, '..');
const sourceSvg = resolve(repo, 'src/assets/logos/app-icon.svg');
const buildDir = resolve(repo, 'build');
const iconsetDir = resolve(buildDir, 'icon.iconset');

// macOS HIG: the rounded-square body sits at ~824/1024 of the canvas, with the
// remainder as transparent padding so the dock can apply its own spacing/shadow.
const ICON_SCALE = 824 / 1024;

const svg = readFileSync(sourceSvg, 'utf8');

const sizes = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  for (const { name, size } of sizes) {
    const inner = Math.round(size * ICON_SCALE);
    const page = await context.newPage();
    await page.setViewportSize({ width: size, height: size });
    const html = `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;background:transparent;}
      body{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;}
      svg{width:${inner}px;height:${inner}px;display:block;}
    </style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buf = await page.screenshot({ omitBackground: true, type: 'png' });
    writeFileSync(resolve(iconsetDir, name), buf);
    await page.close();
    console.log(`wrote ${name} (${size}x${size})`);
  }
} finally {
  await browser.close();
}

cpSync(resolve(iconsetDir, 'icon_512x512@2x.png'), resolve(buildDir, 'icon.png'));
console.log('wrote build/icon.png (1024x1024)');

execSync(`iconutil -c icns -o "${resolve(buildDir, 'icon.icns')}" "${iconsetDir}"`, { stdio: 'inherit' });
console.log('wrote build/icon.icns');
