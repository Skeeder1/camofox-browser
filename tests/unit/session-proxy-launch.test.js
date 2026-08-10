jest.mock('../../dist/src/utils/config', () => ({
  loadConfig: jest.fn(() => ({
    maxSessions: 10,
    maxTabsPerSession: 10,
    sessionTimeoutMs: 60_000,
    proxy: {
      host: '',
      port: '',
      username: '',
      password: '',
    },
  })),
}));

const mockEnsureContext = jest.fn(async (profileKey, userId) => ({
  context: {
    newPage: jest.fn(),
  },
  userId,
  profileKey,
  profileDir: `/tmp/${profileKey}`,
  lastAccess: Date.now(),
  createdAt: Date.now(),
}));
const mockGetEntry = jest.fn();
const mockCloseContext = jest.fn(async () => {});
const mockCloseStagedContextByUserId = jest.fn(async () => {});
const mockCleanupUserDownloads = jest.fn();
const mockCleanupTracing = jest.fn();
const mockStopVnc = jest.fn(async () => {});

jest.mock('../../dist/src/services/context-pool', () => ({
  contextPool: {
    size: jest.fn(() => 0),
    ensureContext: mockEnsureContext,
    getEntry: mockGetEntry,
    onEvict: jest.fn(),
    closeStagedContextByUserId: mockCloseStagedContextByUserId,
    closeContextByUserId: jest.fn(async () => {}),
    closeContext: mockCloseContext,
    closeAll: jest.fn(async () => {}),
  },
}));

jest.mock('../../dist/src/middleware/logging', () => ({
  log: jest.fn(),
}));

jest.mock('../../dist/src/services/download', () => ({
  cleanupUserDownloads: mockCleanupUserDownloads,
}));

jest.mock('../../dist/src/services/health', () => ({
  decrementActiveOps: jest.fn(),
  incrementActiveOps: jest.fn(),
}));

jest.mock('../../dist/src/services/tab', () => ({
  clearAllTabLocks: jest.fn(),
  clearTabLock: jest.fn(),
}));

jest.mock('../../dist/src/services/tracing', () => ({
  cleanupTracing: mockCleanupTracing,
}));

jest.mock('../../dist/src/services/vnc', () => ({
  stopVnc: mockStopVnc,
}));

describe('session proxy launch wiring', () => {
  let session;

  beforeEach(() => {
    jest.resetModules();
    mockEnsureContext.mockClear();
    mockGetEntry.mockReset();
    mockCloseContext.mockClear();
    mockCloseStagedContextByUserId.mockClear();
    mockCleanupUserDownloads.mockClear();
    mockCleanupTracing.mockClear();
    mockStopVnc.mockClear();
    session = require('../../dist/src/services/session');
  });

  afterEach(() => {
    session.clearAllState();
  });

  test('getSession threads the established session proxy into context launch', async () => {
    const proxy = {
      source: 'raw-override',
      server: 'http://proxy.alpha.test:8001',
      username: 'alice',
      password: 'secret',
    };

    session.establishSessionProfile('user-1', 'alpha', {
      sessionKey: 'alpha',
      geoMode: 'explicit-wins',
      proxy,
      signature: 'sig-alpha',
    });

    await session.getSession('user-1', null, 'alpha');

    const profileKey = session.getSessionMapKey('user-1', 'alpha', 'sig-alpha');
    expect(mockEnsureContext).toHaveBeenCalledWith(
      profileKey,
      'user-1',
      expect.any(Object),
      proxy,
    );
  });

  test('session map keys preserve malformed UTF-16 code-unit identity', () => {
    const loneSurrogate = '\ud800';
    const replacement = '\ufffd';

    expect(loneSurrogate).not.toBe(replacement);
    expect(session.getSessionMapKey(loneSurrogate, null)).not.toBe(session.getSessionMapKey(replacement, null));
    expect(session.getSessionMapKey('owner', loneSurrogate)).not.toBe(
      session.getSessionMapKey('owner', replacement),
    );
    expect(session.getSessionMapKey('owner', 'alpha', loneSurrogate)).not.toBe(
      session.getSessionMapKey('owner', 'alpha', replacement),
    );
  });

  test('closeSessionsForUser can preserve profile metadata for display restart recreation', async () => {
    const proxy = {
      source: 'raw-override',
      server: 'http://proxy.display.test:8003',
      username: 'alice',
      password: 'secret',
    };

    session.establishSessionProfile('display-user', 'alpha', {
      sessionKey: 'alpha',
      geoMode: 'explicit-wins',
      proxy,
      signature: 'sig-display',
    });

    await session.getSession('display-user', null, 'alpha');
    await session.closeSessionsForUser('display-user', { clearProfiles: false });
    mockEnsureContext.mockClear();

    await session.getSession('display-user', null, 'alpha');

    const profileKey = session.getSessionMapKey('display-user', 'alpha', 'sig-display');
    expect(mockEnsureContext).toHaveBeenCalledWith(
      profileKey,
      'display-user',
      expect.any(Object),
      proxy,
    );
  });

  test('createStagedSession uses the profile key and proxy for first launch', async () => {
    const proxy = {
      source: 'raw-override',
      server: 'http://proxy.beta.test:8002',
    };

    session.establishSessionProfile('user-2', 'beta', {
      sessionKey: 'beta',
      geoMode: 'explicit-wins',
      proxy,
      signature: 'sig-beta',
    });

    await session.createStagedSession('user-2', null, 'beta');

    const profileKey = session.getSessionMapKey('user-2', 'beta', 'sig-beta');
    expect(mockEnsureContext).toHaveBeenCalledWith(
      profileKey,
      'user-2',
      expect.any(Object),
      proxy,
      true,
      expect.any(String),
    );
  });

  test('rollbackStagedFirstUse closes staged profile-key contexts and releases the first-create mutex', async () => {
    const first = session.acquireFirstCreateMutex('user-3');
    expect(first.acquired).toBe(true);
    const waiter = session.acquireFirstCreateMutex('user-3');
    expect(waiter.acquired).toBe(false);

    await session.rollbackStagedFirstUse('user-3', 'generation-1');

    expect(mockCloseStagedContextByUserId).toHaveBeenCalledWith('user-3', 'generation-1');
    const result = await Promise.race([
      waiter.wait,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
    ]);
    expect(result).toBe(false);
  });

  test('cleanupSessionsForUserId does not match delimiter-colliding user IDs', async () => {
    await session.getSession('alice');
    await session.getSession('alice::beta');

    const aliceKey = session.getSessionMapKey('alice', null);
    const betaKey = session.getSessionMapKey('alice::beta', null);
    expect(session.__getSessionsMapForTests().has(aliceKey)).toBe(true);
    expect(session.__getSessionsMapForTests().has(betaKey)).toBe(true);

    session.cleanupSessionsForUserId('alice', 'unit-test');

    expect(session.__getSessionsMapForTests().has(aliceKey)).toBe(false);
    expect(session.__getSessionsMapForTests().has(betaKey)).toBe(true);
  });

  test('closeSessionsForUser does not treat raw internal session keys as external user IDs', async () => {
    await session.getSession('victim');

    const victimKey = session.getSessionMapKey('victim', null);
    expect(session.__getSessionsMapForTests().has(victimKey)).toBe(true);

    await session.closeSessionsForUser(victimKey);

    expect(session.__getSessionsMapForTests().has(victimKey)).toBe(true);
    expect(mockCleanupTracing).not.toHaveBeenCalledWith('victim');
    expect(mockCleanupUserDownloads).not.toHaveBeenCalledWith('victim');
    expect(mockStopVnc).not.toHaveBeenCalledWith('victim');
  });

  test('getSessionsForUser does not match delimiter-colliding session keys', async () => {
    session.establishSessionProfile('alice', 'beta::one', {
      sessionKey: 'beta::one',
      geoMode: 'explicit-wins',
      proxy: null,
      signature: 'sig-one',
    });

    await session.getSession('alice', null, 'beta::one');

    const wrongUserKeys = session.getSessionsForUser('alice::beta').map(([sessionKey]) => sessionKey);
    expect(wrongUserKeys).toEqual([]);
  });

  test('findTabById rejects delimiter-colliding indexed session owners', async () => {
    const betaSession = await session.getSession('alice::beta');
    const group = session.getTabGroup(betaSession, 'default');
    group.set('tab-collide', {
      page: {},
      createdAt: Date.now(),
      lastAccess: Date.now(),
      url: 'https://example.test/',
    });
    const betaKey = session.getSessionMapKey('alice::beta', null);
    session.indexTab('tab-collide', betaKey);

    expect(session.findTabById('tab-collide', 'alice')).toBeNull();
    expect(session.findTabById('tab-collide', 'alice::beta')).toBeTruthy();
  });

  test('closeAllSessions cleans owner-scoped resources for encoded session keys', async () => {
    await session.getSession('shutdown::owner');
    const mapKey = session.getSessionMapKey('shutdown::owner', null);
    expect(session.__getSessionsMapForTests().has(mapKey)).toBe(true);

    await session.closeAllSessions();

    expect(mockStopVnc).toHaveBeenCalledWith('shutdown::owner');
    expect(mockCleanupTracing).toHaveBeenCalledWith('shutdown::owner');
    expect(mockCleanupUserDownloads).toHaveBeenCalledWith('shutdown::owner');
    expect(session.__getSessionsMapForTests().has(mapKey)).toBe(false);
  });

  test('cleanupSessionsForUserId cleans owner-scoped resources when called with a profile key', async () => {
    session.establishSessionProfile('trace::owner', 'alpha::one', {
      sessionKey: 'alpha::one',
      geoMode: 'explicit-wins',
      proxy: null,
      signature: 'sig-trace',
    });
    await session.getSession('trace::owner', null, 'alpha::one');
    const profileKey = session.getSessionMapKey('trace::owner', 'alpha::one', 'sig-trace');

    session.cleanupSessionsForUserId(profileKey, 'context_evicted', false);

    expect(mockStopVnc).toHaveBeenCalledWith('trace::owner');
    expect(mockCleanupTracing).toHaveBeenCalledWith('trace::owner');
    expect(mockCleanupTracing).not.toHaveBeenCalledWith(profileKey);
    expect(mockCleanupUserDownloads).toHaveBeenCalledWith('trace::owner');
    expect(session.__getSessionsMapForTests().has(profileKey)).toBe(false);
  });

  test('startCleanupInterval cleans trace state by session owner, not encoded session key', async () => {
    jest.useFakeTimers();
    try {
      await session.getSession('timeout::owner');
      const mapKey = session.getSessionMapKey('timeout::owner', null);
      const sessionData = session.__getSessionsMapForTests().get(mapKey);
      sessionData.lastAccess = Date.now() - 60_001;

      session.startCleanupInterval();
      jest.advanceTimersByTime(60_000);

      expect(mockCloseContext).toHaveBeenCalledWith(mapKey);
      expect(mockCleanupTracing).toHaveBeenCalledWith('timeout::owner');
      expect(mockCleanupTracing).not.toHaveBeenCalledWith(mapKey);
    } finally {
      session.stopCleanupInterval();
      jest.useRealTimers();
    }
  });
});
