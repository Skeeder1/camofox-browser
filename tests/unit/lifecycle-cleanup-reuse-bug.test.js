/**
 * Regression test for Wave 2B Task 3 correctness bug:
 * runLifecycleIdleCleanup should NOT cleanup session data when context is reused after snapshot.
 */

// Mock config FIRST
jest.mock('../../dist/src/utils/config', () => ({
  loadConfig: jest.fn(() => ({
    maxSessions: 10,
    userDataDir: '/tmp/camofox-test',
    profilesDir: '/tmp/camofox-test/profiles',
    downloadsDir: '/tmp/camofox-test/downloads',
    port: 3000,
    headless: true,
    vncResolution: '1280x720x24',
    proxy: { host: '', port: '', username: '', password: '' },
    fingerprintDefaults: {},
    sessionTimeoutMs: 600000,
    maxTabsPerSession: 50,
  })),
}));

// Mock camoufox-js
jest.mock('camoufox-js', () => ({
  launchOptions: jest.fn(() => Promise.resolve({})),
}));
jest.mock('camoufox-js/dist/fingerprints.js', () => ({
  generateFingerprint: jest.fn(() => ({})),
}));
jest.mock('camoufox-js/dist/pkgman.js', () => ({
  installedVerStr: jest.fn(() => '1.0.0'),
}));

// Mock playwright-core
jest.mock('playwright-core', () => ({
  firefox: {
    launchPersistentContext: jest.fn(async () => {
      const mockContext = {
        pages: jest.fn(() => []),
        newPage: jest.fn(async () => ({
          close: jest.fn(async () => {}),
        })),
        close: jest.fn(async () => {}),
        on: jest.fn(),
      };
      return mockContext;
    }),
  },
}));

// Mock sidecar and logging
jest.mock('../../dist/src/utils/sidecar-version', () => ({
  readVersionedSidecar: jest.fn(() => null),
  writeVersionedSidecar: jest.fn(),
}));
jest.mock('../../dist/src/middleware/logging', () => ({
  log: jest.fn(),
}));

const {
  runLifecycleIdleCleanup,
  getSession,
  clearAllState,
  __getSessionsMapForTests,
} = require('../../dist/src/services/session');
const { contextPool } = require('../../dist/src/services/context-pool');

describe('runLifecycleIdleCleanup - reuse race bug', () => {
  beforeEach(async () => {
    clearAllState();
  });

  afterEach(async () => {
    clearAllState();
  });

  it('should NOT cleanup session data when context is reused after snapshot', async () => {
    const userId = 'reuse-race-user';
    
    // Manually inject session and context state to simulate the bug scenario
    const sessions = __getSessionsMapForTests();
    
    // Create a mock context
    const mockContext = {
      pages: () => [],
      newPage: async () => ({ close: async () => {} }),
      close: async () => {},
      on: () => {},
    };
    
    // Add session with NO tabs (eligible for cleanup)
    sessions.set(userId, {
      context: mockContext,
      tabGroups: new Map(), // No tabs!
      lastAccess: Date.now() - 10000,
    });
    
    // Add context to pool
    const initialLastAccess = Date.now() - 10000;
    contextPool.pool.set(userId, {
      userId,
      context: mockContext,
      createdAt: Date.now() - 20000,
      lastAccess: initialLastAccess,
      staged: false,
      launching: false,
    });
    
    // Take snapshots (session has 0 tabs, so it's eligible for cleanup)
    const cleanupStartedMs = Date.now();
    const sessionSnapshot = new Map();
    const contextSnapshot = new Map();
    
    for (const [key, session] of sessions) {
      sessionSnapshot.set(key, {
        context: session.context,
        tabGroups: new Map(session.tabGroups),
        lastAccess: session.lastAccess,
      });
    }
    
    for (const [key, entry] of contextPool.pool) {
      contextSnapshot.set(key, { ...entry });
    }
    
    // SIMULATE CONCURRENT REUSE: Update pool's lastAccess AFTER snapshot
    // This simulates a concurrent POST /tabs that reuses the context
    const poolEntry = contextPool.pool.get(userId);
    if (poolEntry) {
      poolEntry.lastAccess = Date.now(); // Changed! Context was reused
    }
    
    // Add a tab to the runtime session (simulating POST /tabs succeeded)
    sessions.get(userId).tabGroups.set('default', new Map([
      ['new-tab-id', {
        tabId: 'new-tab-id',
        page: await mockContext.newPage(),
        url: 'https://example.com/reused',
        createdAt: Date.now(),
      }]
    ]));
    
    // Run cleanup with old snapshots
    // closeContextIfMatches should detect lastAccess changed and NOT close
    // BUT BUG: cleanupSessionsForUserId runs unconditionally for all usersToCleanup
    await runLifecycleIdleCleanup(sessionSnapshot, contextSnapshot, cleanupStartedMs);
    
    // VERIFY BUG: Session data was deleted even though context wasn't closed
    const sessionAfter = sessions.get(userId);
    
    // This test WILL FAIL on current buggy code because session data gets deleted
    expect(sessionAfter).toBeDefined();
    expect(sessionAfter.tabGroups.size).toBeGreaterThan(0);
    
    // Context should still be in pool (this currently works correctly)
    const poolAfter = contextPool.pool.get(userId);
    expect(poolAfter).toBeDefined();
  }, 30000);

  it('cleans only the zero-tab profile-key session during idle cleanup', async () => {
    const userId = 'profile-idle-user';
    const alphaKey = `${userId}::alpha::sig-a`;
    const betaKey = `${userId}::beta::sig-b`;
    const sessions = __getSessionsMapForTests();
    const now = Date.now();

    const alphaContext = {
      pages: () => [],
      newPage: async () => ({ close: async () => {} }),
      close: jest.fn(async () => {}),
      on: () => {},
    };
    const betaContext = {
      pages: () => [],
      newPage: async () => ({ close: async () => {} }),
      close: jest.fn(async () => {}),
      on: () => {},
    };

    sessions.set(alphaKey, {
      context: alphaContext,
      tabGroups: new Map(),
      lastAccess: now - 10000,
    });
    sessions.set(betaKey, {
      context: betaContext,
      tabGroups: new Map([
        ['beta', new Map([
          ['tab-beta', {
            tabId: 'tab-beta',
            page: await betaContext.newPage(),
            url: 'https://example.com/beta',
            createdAt: now,
          }],
        ])],
      ]),
      lastAccess: now - 10000,
    });

    contextPool.pool.set(alphaKey, {
      userId,
      profileKey: alphaKey,
      profileDir: `/tmp/${alphaKey}`,
      context: alphaContext,
      createdAt: now - 20000,
      lastAccess: now - 10000,
      staged: false,
      launching: false,
    });
    contextPool.pool.set(betaKey, {
      userId,
      profileKey: betaKey,
      profileDir: `/tmp/${betaKey}`,
      context: betaContext,
      createdAt: now - 20000,
      lastAccess: now - 10000,
      staged: false,
      launching: false,
    });

    const sessionSnapshot = new Map();
    const contextSnapshot = new Map();
    for (const [key, session] of sessions) {
      sessionSnapshot.set(key, {
        context: session.context,
        tabGroups: new Map(session.tabGroups),
        lastAccess: session.lastAccess,
      });
    }
    for (const [key, entry] of contextPool.pool) {
      contextSnapshot.set(key, { ...entry });
    }

    const result = await runLifecycleIdleCleanup(sessionSnapshot, contextSnapshot, now);

    expect(result.closedUsers).toEqual([alphaKey]);
    expect(sessions.has(alphaKey)).toBe(false);
    expect(contextPool.pool.has(alphaKey)).toBe(false);
    expect(sessions.has(betaKey)).toBe(true);
    expect(contextPool.pool.has(betaKey)).toBe(true);
    expect(alphaContext.close).toHaveBeenCalled();
    expect(betaContext.close).not.toHaveBeenCalled();
  }, 30000);

  it('should not hand back a context while idle cleanup close is in flight', async () => {
    const userId = 'closing-race-user';
    const sessions = __getSessionsMapForTests();

    let closeStartedResolve;
    const closeStarted = new Promise((resolve) => {
      closeStartedResolve = resolve;
    });
    let allowCloseResolve;
    const allowClose = new Promise((resolve) => {
      allowCloseResolve = resolve;
    });
    let closed = false;

    const closingContext = {
      pages: () => [],
      newPage: async () => {
        if (closed) {
          throw new Error('browserContext.newPage: Target page, context or browser has been closed');
        }
        return { close: async () => {} };
      },
      close: async () => {
        closeStartedResolve();
        await allowClose;
        closed = true;
      },
      on: () => {},
    };

    sessions.set(userId, {
      context: closingContext,
      tabGroups: new Map(),
      lastAccess: Date.now() - 10000,
    });

    const initialLastAccess = Date.now() - 10000;
    contextPool.pool.set(userId, {
      userId,
      profileKey: userId,
      profileDir: '/tmp/camofox-test/profile',
      context: closingContext,
      createdAt: Date.now() - 20000,
      lastAccess: initialLastAccess,
      staged: false,
      launching: undefined,
    });

    const cleanupStartedMs = Date.now();
    const sessionSnapshot = new Map();
    const contextSnapshot = new Map();

    for (const [key, session] of sessions) {
      sessionSnapshot.set(key, {
        context: session.context,
        tabGroups: new Map(session.tabGroups),
        lastAccess: session.lastAccess,
      });
    }

    for (const [key, entry] of contextPool.pool) {
      contextSnapshot.set(key, { ...entry });
    }

    const cleanupPromise = runLifecycleIdleCleanup(sessionSnapshot, contextSnapshot, cleanupStartedMs);
    await closeStarted;

    let getSessionResolved = false;
    const getSessionPromise = getSession(userId).then((session) => {
      getSessionResolved = true;
      return session;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(getSessionResolved).toBe(false);

    allowCloseResolve();
    await cleanupPromise;

    const reusedSession = await getSessionPromise;
    expect(reusedSession.context).not.toBe(closingContext);
    await expect(reusedSession.context.newPage()).resolves.toBeDefined();
  }, 30000);
});
