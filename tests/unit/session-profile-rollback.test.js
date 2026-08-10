describe('session profile rollback after runtime allocation failure', () => {
  let session;
  let mockCloseContext;
  let mockNavigateWithSafetyGuard;
  let mockCreateTabState;

  const makePage = () => ({
    url: jest.fn(() => 'about:blank'),
    title: jest.fn(async () => ''),
    isClosed: jest.fn(() => false),
    close: jest.fn(async () => {}),
    on: jest.fn(),
  });

  function installCommonMocks() {
    mockCloseContext = jest.fn(async () => {});
    mockNavigateWithSafetyGuard = jest.fn(async () => {
      throw new Error('navigation boom');
    });
    mockCreateTabState = jest.fn(async (page) => ({
      page,
      refs: new Map(),
      blockedNavigationUrls: [],
      visitedUrls: new Set(),
      toolCalls: 0,
    }));

    jest.doMock('../../dist/src/utils/config', () => ({
      loadConfig: jest.fn(() => ({
        apiKey: '',
        adminKey: '',
        allowPrivateNetworkTargets: true,
        maxConcurrentPerUser: 10,
        maxSessions: 10,
        maxTabsPerSession: 10,
        sessionTimeoutMs: 60_000,
        proxyProfilesFile: undefined,
        proxy: { host: '', port: '', username: '', password: '' },
      })),
    }));
    jest.doMock('../../dist/src/middleware/errors', () => ({
      safeError: (err) => (err instanceof Error ? err.message : String(err)),
    }));
    jest.doMock('../../dist/src/middleware/logging', () => ({ log: jest.fn() }));
    jest.doMock('../../dist/src/middleware/auth', () => ({
      isAuthorizedWithApiKey: jest.fn().mockReturnValue(true),
      isAuthorizedWithAdminKey: jest.fn().mockReturnValue(true),
    }));
    jest.doMock('../../dist/src/middleware/rate-limit', () => ({ checkRateLimit: jest.fn() }));
    jest.doMock('../../dist/src/utils/presets', () => ({
      contextHash: jest.fn((value) => JSON.stringify(value ?? null)),
      getAllPresets: jest.fn().mockReturnValue({}),
      resolveContextOptions: jest.fn().mockReturnValue(null),
      validateContextOptions: jest.fn().mockReturnValue(null),
    }));
    jest.doMock('../../dist/src/utils/proxy-profiles', () => ({
      getConfiguredServerProxy: jest.fn().mockReturnValue(null),
      loadProxyProfiles: jest.fn().mockReturnValue({
        'tokyo-exit': {
          proxy: { server: 'http://127.0.0.1:8888' },
        },
      }),
      resolveSessionProfileInput: jest.fn((input) => ({
        sessionKey: input.sessionKey,
        geoMode: input.geoMode || 'explicit-wins',
        proxy: { source: 'profile', server: 'http://127.0.0.1:8888' },
        signature: 'sig-provisional',
      })),
    }));
    jest.doMock('../../dist/src/services/context-pool', () => ({
      contextPool: {
        size: jest.fn(() => 0),
        ensureContext: jest.fn(async (profileKey, userId) => ({
          context: { newPage: jest.fn(async () => makePage()) },
          userId,
          profileKey,
          profileDir: `/tmp/${profileKey}`,
          lastAccess: Date.now(),
          createdAt: Date.now(),
        })),
        getEntry: jest.fn(),
        onEvict: jest.fn(),
        closeContext: mockCloseContext,
        closeContextByUserId: jest.fn(async () => {}),
        closeStagedContextByUserId: jest.fn(async () => {}),
        closeAll: jest.fn(async () => {}),
        listActiveUserIds: jest.fn(() => []),
        restartContext: jest.fn(async () => ({})),
        setHeadlessOverride: jest.fn(),
      },
      getDisplayForUser: jest.fn(),
    }));
    jest.doMock('../../dist/src/services/download', () => ({
      commitStagedDownloads: jest.fn(),
      registerDownloadListener: jest.fn(),
      listDownloads: jest.fn(),
      getDownload: jest.fn(),
      getDownloadPath: jest.fn(),
      deleteDownload: jest.fn(),
      getRecentDownloads: jest.fn(),
      cleanupUserDownloads: jest.fn(),
      markDownloadsStaged: jest.fn(),
    }));
    jest.doMock('../../dist/src/services/tab', () => ({
      acquirePageForNewTab: jest.fn((context) => context.newPage()),
      backTab: jest.fn(),
      buildSnapshotPayload: jest.fn(),
      buildRefs: jest.fn(),
      clickTab: jest.fn(),
      createTabState: mockCreateTabState,
      clearAllTabLocks: jest.fn(),
      clearTabLock: jest.fn(),
      evaluateTab: jest.fn(),
      evaluateTabExtended: jest.fn(),
      flushBlockedNavigationError: jest.fn(),
      forwardTab: jest.fn(),
      getLinks: jest.fn(),
      pressTab: jest.fn(),
      refreshTab: jest.fn(),
      refToLocator: jest.fn(),
      screenshotTab: jest.fn(),
      scrollTab: jest.fn(),
      scrollElementTab: jest.fn(),
      smartFill: jest.fn(),
      snapshotTab: jest.fn(),
      calculateTypeTimeoutMs: jest.fn(),
      navigateWithSafetyGuard: mockNavigateWithSafetyGuard,
      typeTab: jest.fn(),
      safePageClose: jest.fn(async () => {}),
      validateNavigationUrl: jest.fn(async () => null),
      waitForPageReady: jest.fn(),
      withBlockedNavigationTracking: jest.fn((_page, operation) => operation()),
      withTimeout: jest.fn((value) => value),
      withTabLock: jest.fn((_tabId, operation) => operation()),
    }));
    jest.doMock('../../dist/src/services/resource-extractor', () => ({
      extractImages: jest.fn(),
      extractResources: jest.fn(),
      resolveBlob: jest.fn(),
    }));
    jest.doMock('../../dist/src/services/structured-extractor', () => ({
      StructuredExtractRuntimeError: class StructuredExtractRuntimeError extends Error {},
      StructuredExtractSchemaError: class StructuredExtractSchemaError extends Error {},
      extractStructuredData: jest.fn(),
    }));
    jest.doMock('../../dist/src/services/batch-downloader', () => ({ batchDownload: jest.fn() }));
    jest.doMock('../../dist/src/services/tracing', () => ({
      cleanupTracing: jest.fn(),
      startTracing: jest.fn(),
      stopTracing: jest.fn(),
      startTracingChunk: jest.fn(),
      stopTracingChunk: jest.fn(),
      getTracingState: jest.fn(),
      listTraceArtifacts: jest.fn().mockReturnValue([]),
      resolveTraceArtifactPath: jest.fn(),
      deleteTraceArtifact: jest.fn(),
    }));
    jest.doMock('../../dist/src/services/lifecycle-controller', () => ({
      lifecycleController: { recordInteractiveActivity: jest.fn() },
    }));
    jest.doMock('../../dist/src/services/vnc', () => ({
      startVnc: jest.fn(),
      stopVnc: jest.fn(),
    }));
    jest.doMock('../../dist/src/services/browser', () => ({ closeBrowser: jest.fn() }));
  }

  async function waitFor(predicate, message) {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(message);
  }

  async function waitForMaybe(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return predicate();
  }

  async function invokeRoute(router, path, method, body, params = {}) {
    const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
    if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    let statusCode = 200;
    let jsonBody;
    const req = {
      body,
      headers: {},
      method: method.toUpperCase(),
      originalUrl: path,
      params,
      path,
      query: {},
      reqId: 'test-req',
      url: path,
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonBody = payload;
        return this;
      },
    };
    await handler(req, res, (err) => {
      if (err) throw err;
    });
    return { statusCode, body: jsonBody };
  }

  beforeEach(() => {
    jest.resetModules();
    installCommonMocks();
    session = require('../../dist/src/services/session');
  });

  afterEach(() => {
    session.clearAllState();
  });

  test('core create removes the provisional profile-key session when navigation fails', async () => {
    const router = require('../../dist/src/routes/core').default;
    const userId = 'rollback-core-runtime';
    const sessionKey = 'retry';
    const profileKey = session.getSessionMapKey(userId, sessionKey, 'sig-provisional');
    session.commitCanonicalProfile(userId, null);

    const response = await invokeRoute(router, '/tabs', 'post', {
      userId,
      sessionKey,
      url: 'https://example.test/fail',
      proxyProfile: 'tokyo-exit',
    });

    expect(response.statusCode).toBe(500);
    expect(session.getEstablishedSessionProfile(userId, sessionKey)).toBeUndefined();
    expect(session.getSessionsForUser(userId)).toHaveLength(0);
    expect(mockCloseContext).toHaveBeenCalledWith(profileKey);
  });

  test('OpenClaw open removes the provisional profile-key session when navigation fails', async () => {
    session.commitCanonicalProfile('rollback-openclaw-runtime', null);
    const router = require('../../dist/src/routes/openclaw').default;
    const userId = 'rollback-openclaw-runtime';
    const sessionKey = 'list-item';
    const profileKey = session.getSessionMapKey(userId, sessionKey, 'sig-provisional');

    const response = await invokeRoute(router, '/tabs/open', 'post', {
      userId,
      listItemId: sessionKey,
      url: 'https://example.test/fail',
      proxyProfile: 'tokyo-exit',
    });

    expect(response.statusCode).toBe(500);
    expect(session.getEstablishedSessionProfile(userId, sessionKey)).toBeUndefined();
    expect(session.getSessionsForUser(userId)).toHaveLength(0);
    expect(mockCloseContext).toHaveBeenCalledWith(profileKey);
  });

  test('rollback from one request does not remove a concurrent successful same-profile tab', async () => {
    const router = require('../../dist/src/routes/core').default;
    const userId = 'rollback-concurrent-runtime';
    const sessionKey = 'retry';
    session.commitCanonicalProfile(userId, null);

    let rejectFirstNavigation;
    mockNavigateWithSafetyGuard
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectFirstNavigation = reject;
      }))
      .mockResolvedValueOnce(undefined);

    const first = invokeRoute(router, '/tabs', 'post', {
      userId,
      sessionKey,
      url: 'https://example.test/fail',
      proxyProfile: 'tokyo-exit',
    });
    await waitFor(() => mockNavigateWithSafetyGuard.mock.calls.length === 1, 'first navigation did not start');

    const second = invokeRoute(router, '/tabs', 'post', {
      userId,
      sessionKey,
      url: 'https://example.test/succeed',
      proxyProfile: 'tokyo-exit',
    });
    await waitForMaybe(() => mockNavigateWithSafetyGuard.mock.calls.length === 2, 50);

    rejectFirstNavigation(new Error('navigation boom'));
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.statusCode).toBe(500);
    expect(secondResponse.statusCode).toBe(200);
    expect(session.getEstablishedSessionProfile(userId, sessionKey)).toBeDefined();
    expect(session.getSessionsForUser(userId)).toHaveLength(1);
  });

  test('core create rejects a profile request racing an unprofiled same-session create', async () => {
    const router = require('../../dist/src/routes/core').default;
    const userId = 'mixed-profile-core-runtime';
    const sessionKey = 'shared';
    session.commitCanonicalProfile(userId, null);

    let resolveFirstNavigation;
    mockNavigateWithSafetyGuard
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstNavigation = resolve;
      }))
      .mockResolvedValueOnce(undefined);

    const unprofiled = invokeRoute(router, '/tabs', 'post', {
      userId,
      sessionKey,
      url: 'https://example.test/default',
    });
    await waitFor(() => mockNavigateWithSafetyGuard.mock.calls.length === 1, 'unprofiled navigation did not start');

    const profiled = await invokeRoute(router, '/tabs', 'post', {
      userId,
      sessionKey,
      url: 'https://example.test/profile',
      proxyProfile: 'tokyo-exit',
    });

    resolveFirstNavigation();
    const unprofiledResponse = await unprofiled;

    expect(unprofiledResponse.statusCode).toBe(200);
    expect(profiled.statusCode).toBe(409);
    expect(profiled.body.error).toBe('Session profile conflict');
    expect(session.getEstablishedSessionProfile(userId, sessionKey)).toBeUndefined();
    expect(session.getSessionsForUser(userId)).toHaveLength(1);
  });

  test('OpenClaw open rejects a profile request racing an unprofiled same-session open', async () => {
    const router = require('../../dist/src/routes/openclaw').default;
    const userId = 'mixed-profile-openclaw-runtime';
    const sessionKey = 'shared';
    session.commitCanonicalProfile(userId, null);

    let resolveFirstNavigation;
    mockNavigateWithSafetyGuard
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstNavigation = resolve;
      }))
      .mockResolvedValueOnce(undefined);

    const unprofiled = invokeRoute(router, '/tabs/open', 'post', {
      userId,
      listItemId: sessionKey,
      url: 'https://example.test/default',
    });
    await waitFor(() => mockNavigateWithSafetyGuard.mock.calls.length === 1, 'unprofiled navigation did not start');

    const profiled = await invokeRoute(router, '/tabs/open', 'post', {
      userId,
      listItemId: sessionKey,
      url: 'https://example.test/profile',
      proxyProfile: 'tokyo-exit',
    });

    resolveFirstNavigation();
    const unprofiledResponse = await unprofiled;

    expect(unprofiledResponse.statusCode).toBe(200);
    expect(profiled.statusCode).toBe(409);
    expect(profiled.body.error).toBe('Session profile conflict');
    expect(session.getEstablishedSessionProfile(userId, sessionKey)).toBeUndefined();
    expect(session.getSessionsForUser(userId)).toHaveLength(1);
  });

  test('timeout cleanup clears default runtime claims so later profile requests can configure the session', async () => {
    jest.useFakeTimers();
    try {
      const router = require('../../dist/src/routes/core').default;
      const userId = 'timeout-default-claim-runtime';
      const sessionKey = 'shared';
      session.commitCanonicalProfile(userId, null);
      mockNavigateWithSafetyGuard.mockResolvedValue(undefined);

      const unprofiled = await invokeRoute(router, '/tabs', 'post', {
        userId,
        sessionKey,
        url: 'https://example.test/default',
      });
      expect(unprofiled.statusCode).toBe(200);
      expect(session.hasDefaultSessionProfileRuntime(userId, sessionKey)).toBe(true);

      const sessionMapKey = session.getSessionMapKey(userId, null);
      const sessionData = session.__getSessionsMapForTests().get(sessionMapKey);
      sessionData.lastAccess = Date.now() - 60_001;
      session.startCleanupInterval();
      jest.advanceTimersByTime(60_000);

      expect(session.getSessionsForUser(userId)).toHaveLength(0);
      expect(session.hasDefaultSessionProfileRuntime(userId, sessionKey)).toBe(false);

      const profiled = await invokeRoute(router, '/tabs', 'post', {
        userId,
        sessionKey,
        url: 'https://example.test/profile',
        proxyProfile: 'tokyo-exit',
      });

      expect(profiled.statusCode).toBe(200);
      expect(session.getEstablishedSessionProfile(userId, sessionKey)).toBeDefined();
    } finally {
      session.stopCleanupInterval();
      jest.useRealTimers();
    }
  });

  test('timeout cleanup clears default runtime claims after the last tab group was closed', async () => {
    jest.useFakeTimers();
    try {
      const router = require('../../dist/src/routes/core').default;
      const userId = 'timeout-closed-tab-default-claim-runtime';
      const sessionKey = 'shared';
      session.commitCanonicalProfile(userId, null);
      mockNavigateWithSafetyGuard.mockResolvedValue(undefined);

      const unprofiled = await invokeRoute(router, '/tabs', 'post', {
        userId,
        sessionKey,
        url: 'https://example.test/default',
      });
      expect(unprofiled.statusCode).toBe(200);
      expect(session.hasDefaultSessionProfileRuntime(userId, sessionKey)).toBe(true);

      const close = await invokeRoute(router, '/tabs/:tabId', 'delete', { userId }, { tabId: unprofiled.body.tabId });
      expect(close.statusCode).toBe(200);

      const sessionMapKey = session.getSessionMapKey(userId, null);
      const sessionData = session.__getSessionsMapForTests().get(sessionMapKey);
      expect(sessionData.tabGroups.has(sessionKey)).toBe(false);
      sessionData.lastAccess = Date.now() - 60_001;
      session.startCleanupInterval();
      jest.advanceTimersByTime(60_000);

      expect(session.getSessionsForUser(userId)).toHaveLength(0);
      expect(session.hasDefaultSessionProfileRuntime(userId, sessionKey)).toBe(false);
    } finally {
      session.stopCleanupInterval();
      jest.useRealTimers();
    }
  });

  test('core max-tabs rejection clears a provisional default runtime claim', async () => {
    const router = require('../../dist/src/routes/core').default;
    const userId = 'max-tabs-default-claim-runtime';
    const existingSessionKey = 'existing';
    const rejectedSessionKey = 'fresh';
    session.commitCanonicalProfile(userId, null);

    const sessionData = await session.getSession(userId, null, existingSessionKey);
    const group = session.getTabGroup(sessionData, existingSessionKey);
    for (let i = 0; i < 10; i += 1) group.set(`tab-${i}`, {});

    const rejected = await invokeRoute(router, '/tabs', 'post', {
      userId,
      sessionKey: rejectedSessionKey,
      url: 'https://example.test/overflow',
    });

    expect(rejected.statusCode).toBe(429);
    expect(session.hasDefaultSessionProfileRuntime(userId, rejectedSessionKey)).toBe(false);

    group.clear();
    mockNavigateWithSafetyGuard.mockResolvedValue(undefined);
    const profiled = await invokeRoute(router, '/tabs', 'post', {
      userId,
      sessionKey: rejectedSessionKey,
      url: 'https://example.test/profile',
      proxyProfile: 'tokyo-exit',
    });

    expect(profiled.statusCode).toBe(200);
    expect(session.getEstablishedSessionProfile(userId, rejectedSessionKey)).toBeDefined();
  });

  test('OpenClaw max-tabs rejection clears a provisional default runtime claim', async () => {
    const router = require('../../dist/src/routes/openclaw').default;
    const userId = 'max-tabs-openclaw-default-claim-runtime';
    const existingSessionKey = 'existing';
    const rejectedSessionKey = 'fresh';
    session.commitCanonicalProfile(userId, null);

    const sessionData = await session.getSession(userId, null, existingSessionKey);
    const group = session.getTabGroup(sessionData, existingSessionKey);
    for (let i = 0; i < 10; i += 1) group.set(`tab-${i}`, {});

    const rejected = await invokeRoute(router, '/tabs/open', 'post', {
      userId,
      listItemId: rejectedSessionKey,
      url: 'https://example.test/overflow',
    });

    expect(rejected.statusCode).toBe(429);
    expect(session.hasDefaultSessionProfileRuntime(userId, rejectedSessionKey)).toBe(false);

    group.clear();
    mockNavigateWithSafetyGuard.mockResolvedValue(undefined);
    const profiled = await invokeRoute(router, '/tabs/open', 'post', {
      userId,
      listItemId: rejectedSessionKey,
      url: 'https://example.test/profile',
      proxyProfile: 'tokyo-exit',
    });

    expect(profiled.statusCode).toBe(200);
    expect(session.getEstablishedSessionProfile(userId, rejectedSessionKey)).toBeDefined();
  });

  test('failed unprofiled first-create rollback clears default runtime claims', async () => {
    const router = require('../../dist/src/routes/core').default;
    const userId = 'failed-default-claim-runtime';
    const sessionKey = 'shared';
    mockNavigateWithSafetyGuard.mockResolvedValue(undefined);

    const response = await invokeRoute(router, '/tabs', 'post', {
      userId,
      sessionKey,
      url: 'https://example.test/default',
    });

    expect(response.statusCode).toBe(409);
    expect(response.body.error).toBe('Session closed during creation');
    expect(session.hasDefaultSessionProfileRuntime(userId, sessionKey)).toBe(false);
  });
});
