import { describe, expect, it } from 'vitest';

import {
  parseStoredWorkspaceSession,
  serializeWorkspaceSession,
} from '../workspace-session';

describe('workspace session', () => {
  it('returns an empty session for missing or malformed input', () => {
    expect(parseStoredWorkspaceSession(null)).toEqual({ tabs: [], selectedIndex: 0 });
    expect(parseStoredWorkspaceSession('{not json')).toEqual({
      tabs: [],
      selectedIndex: 0,
    });
    expect(parseStoredWorkspaceSession('[]')).toEqual({ tabs: [], selectedIndex: 0 });
    expect(parseStoredWorkspaceSession(JSON.stringify({ tabs: 'nope' }))).toEqual({
      tabs: [],
      selectedIndex: 0,
    });
  });

  it('parses tabs and clamps an out-of-range selected index', () => {
    expect(
      parseStoredWorkspaceSession(
        JSON.stringify({ version: 1, tabs: ['a', 'b'], selectedIndex: 9 }),
      ),
    ).toEqual({ tabs: ['a', 'b'], selectedIndex: 0 });
  });

  it('filters non-string and empty tab ids', () => {
    expect(
      parseStoredWorkspaceSession(
        JSON.stringify({ tabs: ['a', 2, '', null, 'b'], selectedIndex: 1 }),
      ),
    ).toEqual({ tabs: ['a', 'b'], selectedIndex: 1 });
  });

  it('serializes with a clamped selected index', () => {
    expect(
      JSON.parse(serializeWorkspaceSession({ tabs: ['a', 'b'], selectedIndex: -5 })),
    ).toEqual({ version: 1, tabs: ['a', 'b'], selectedIndex: 0 });
    expect(
      JSON.parse(serializeWorkspaceSession({ tabs: [], selectedIndex: 4 })),
    ).toEqual({ version: 1, tabs: [], selectedIndex: 0 });
  });
});
