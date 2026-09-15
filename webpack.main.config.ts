import type { Configuration } from 'webpack';
import path from 'path';

import { nativeRules, rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/index.ts',
  module: {
    rules: [...nativeRules, ...rules],
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
};
