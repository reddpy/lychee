import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/tmp/lychee-mcp-test' },
}));

import { buildServerConfig, defaultVaultPath, manualMcpConfig, mcpSetupFields, resolveVaultRoot } from '../mcp-config';

describe('mcp-config', () => {
  it('scopes a shared folder to a dedicated Lychee subfolder', () => {
    expect(resolveVaultRoot('/Users/me/Downloads')).toBe('/Users/me/Downloads/Lychee');
    expect(resolveVaultRoot('/Users/me/Documents/Lychee')).toBe('/Users/me/Documents/Lychee');
  });

  it('defaults the vault to a user-visible Lychee folder', () => {
    expect(defaultVaultPath()).toBe('/tmp/lychee-mcp-test/Lychee');
  });

  it('builds a stdio server config that runs Lychee as node', () => {
    const config = buildServerConfig('/vault');
    expect(config.command).toBe(process.execPath);
    expect(config.args).toEqual([
      '/app/out/mcp/lychee-mcp.mjs',
      '--vault',
      '/vault',
    ]);
    expect(config.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });

  it('exposes the field values a manual client UI asks for', () => {
    const setup = mcpSetupFields('/vault');
    expect(setup).toMatchObject({
      name: 'Lychee',
      type: 'STDIO',
      workingDirectory: '/vault',
    });
    expect(setup.args).toContain('--vault');
    expect(setup.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });

  it('produces pasteable mcpServers JSON', () => {
    const parsed = JSON.parse(manualMcpConfig('/vault'));
    expect(parsed.mcpServers.lychee.command).toBe(process.execPath);
    expect(parsed.mcpServers.lychee.args).toContain('/vault');
  });
});
