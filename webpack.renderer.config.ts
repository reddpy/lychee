import type { Configuration } from 'webpack';
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
