import { type Configuration, DefinePlugin } from 'webpack';
import path from 'path';
import CopyPlugin from 'copy-webpack-plugin';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push({
  test: /\.css$/,
  use: [
    { loader: 'style-loader' },
    { loader: 'css-loader' },
    { loader: 'postcss-loader' },
  ],
});

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  ignoreWarnings: [
    {
      module: /framer-motion[\\/]dist[\\/]cjs[\\/]feature-bundle-.*\.js$/,
      message: /Critical dependency: the request of a dependency is an expression/,
    },
  ],
  plugins: [
    ...plugins,
    // Build-time flag for E2E-only renderer code (E2ECrashProbe). Baked from the
    // E2E env var at build time so production bundles (built without E2E=1) get
    // the literal `false` and Terser strips the gated code entirely. Deliberately
    // a dedicated token — NOT process.env.E2E — so the preload's runtime E2E gate
    // (src/preload.ts) is left untouched even though it shares this config.
    new DefinePlugin({
      __LYCHEE_E2E__: JSON.stringify(process.env.E2E === '1'),
    }),
    // Emit theme-bootstrap.js alongside index.html so <head> can load it
    // synchronously pre-paint without bundling it into the main renderer chunk.
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'src/theme-bootstrap.js'),
          // Forge emits the renderer entry under <output>/main_window/, so the
          // bootstrap has to land in the same dir for index.html's relative
          // <script src> to resolve.
          to: 'main_window/theme-bootstrap.js',
        },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
};
