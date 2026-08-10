describe('display toggle route', () => {
  test('prewarms the existing profile-key context and returns VNC URL for virtual mode', async () => {
    jest.resetModules();

    const closeSessionsForUser = jest.fn().mockResolvedValue(undefined);
    const restartContext = jest.fn().mockResolvedValue({});
    const setHeadlessOverride = jest.fn();
    const getDisplayForUser = jest.fn().mockReturnValue(':77');
    const startVnc = jest.fn().mockResolvedValue({ vncUrl: 'http://127.0.0.1:59077' });
    const stopVnc = jest.fn().mockResolvedValue(undefined);
    const profileSeedOptions = {
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { latitude: 40.7128, longitude: -74.006 },
      viewport: { width: 1280, height: 720 },
    };
    const profileProxy = { source: 'raw-override', server: 'http://proxy.example:8080' };
    const getSessionsForUser = jest.fn().mockReturnValue([
      ['p:dXNlcg:YWxwaGE:c2ln', { context: {}, tabGroups: new Map() }],
    ]);

    jest.doMock('../../dist/src/middleware/errors', () => ({
      safeError: (err) => (err instanceof Error ? err.message : String(err)),
    }));
    jest.doMock('../../dist/src/middleware/logging', () => ({ log: jest.fn() }));
    jest.doMock('../../dist/src/middleware/auth', () => ({ isAuthorizedWithApiKey: jest.fn().mockReturnValue(true) }));
    jest.doMock('../../dist/src/middleware/rate-limit', () => ({ checkRateLimit: jest.fn() }));
    jest.doMock('../../dist/src/utils/config', () => ({ loadConfig: () => ({ apiKey: '' }) }));
    jest.doMock('../../dist/src/utils/presets', () => ({
      getAllPresets: jest.fn().mockReturnValue({}),
      resolveContextOptions: jest.fn().mockReturnValue(null),
      validateContextOptions: jest.fn().mockReturnValue(null),
    }));
    jest.doMock('../../dist/src/services/context-pool', () => ({
      contextPool: {
        getEntry: jest.fn().mockReturnValue({ seedOptions: profileSeedOptions, proxyConfig: profileProxy }),
        listActiveUserIds: jest.fn().mockReturnValue([]),
        restartContext,
        setHeadlessOverride,
        size: jest.fn().mockReturnValue(0),
      },
      getDisplayForUser,
    }));
    jest.doMock('../../dist/src/services/lifecycle-controller', () => ({
      lifecycleController: { recordInteractiveActivity: jest.fn() },
    }));
    jest.doMock('../../dist/src/services/vnc', () => ({ startVnc, stopVnc }));
    jest.doMock('../../dist/src/services/session', () => ({
      MAX_TABS_PER_SESSION: 10,
      acquireFirstCreateMutex: jest.fn(),
      clearSessionProfile: jest.fn(),
      commitStagedFirstUse: jest.fn(),
      createCanonicalProfile: jest.fn(),
      createStagedSession: jest.fn(),
      establishSessionProfile: jest.fn(),
      findTabById: jest.fn(),
      getCanonicalProfile: jest.fn(),
      getEstablishedSessionProfile: jest.fn(),
      getSession: jest.fn(),
      getSessionMapKey: jest.fn(),
      getSessionsForUser,
      getTabGroup: jest.fn(),
      indexTab: jest.fn(),
      normalizeUserId: (value) => String(value),
      rollbackCanonicalMutex: jest.fn(),
      rollbackStagedFirstUse: jest.fn(),
      unindexTab: jest.fn(),
      closeSessionsForUser,
      countTotalTabsForSessions: jest.fn().mockReturnValue(0),
      withUserLimit: jest.fn((_userId, _limit, operation) => operation()),
    }));
    jest.doMock('../../dist/src/services/tab', () => ({
      backTab: jest.fn(),
      buildSnapshotPayload: jest.fn(),
      buildRefs: jest.fn(),
      clickTab: jest.fn(),
      createTabState: jest.fn(),
      evaluateTab: jest.fn(),
      evaluateTabExtended: jest.fn(),
      forwardTab: jest.fn(),
      getLinks: jest.fn(),
      pressTab: jest.fn(),
      refreshTab: jest.fn(),
      screenshotTab: jest.fn(),
      scrollTab: jest.fn(),
      scrollElementTab: jest.fn(),
      snapshotTab: jest.fn(),
      calculateTypeTimeoutMs: jest.fn(),
      navigateWithSafetyGuard: jest.fn(),
      typeTab: jest.fn(),
      safePageClose: jest.fn(),
      validateNavigationUrl: jest.fn(),
      waitForPageReady: jest.fn(),
      withTimeout: jest.fn(),
      withTabLock: jest.fn(),
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
      startTracing: jest.fn(),
      stopTracing: jest.fn(),
      startTracingChunk: jest.fn(),
      stopTracingChunk: jest.fn(),
      getTracingState: jest.fn(),
      listTraceArtifacts: jest.fn().mockReturnValue([]),
      resolveTraceArtifactPath: jest.fn(),
      deleteTraceArtifact: jest.fn(),
    }));

    const express = require('express');
    const router = require('../../dist/src/routes/core').default;
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });

    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/sessions/user-a/toggle-display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: 'virtual' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(closeSessionsForUser).toHaveBeenCalledWith('user-a', { clearProfiles: false });
      expect(restartContext).toHaveBeenCalledWith(
        'user-a',
        'virtual',
        'p:dXNlcg:YWxwaGE:c2ln',
        profileSeedOptions,
        profileProxy,
      );
      expect(setHeadlessOverride).not.toHaveBeenCalled();
      expect(startVnc).toHaveBeenCalledWith('user-a', ':77');
      expect(body).toMatchObject({
        ok: true,
        headless: 'virtual',
        tabsInvalidated: true,
        vncUrl: 'http://127.0.0.1:59077',
        message: 'Browser visible via VNC',
        userId: 'user-a',
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('derives prewarm settings from session profile when the pool entry was evicted', async () => {
    jest.resetModules();

    const closeSessionsForUser = jest.fn().mockResolvedValue(undefined);
    const restartContext = jest.fn().mockResolvedValue({});
    const setHeadlessOverride = jest.fn();
    const getDisplayForUser = jest.fn().mockReturnValue(':77');
    const startVnc = jest.fn().mockResolvedValue({ vncUrl: 'http://127.0.0.1:59077' });
    const stopVnc = jest.fn().mockResolvedValue(undefined);
    const profileLaunchSettings = {
      contextOverrides: {
        locale: 'en-US',
        timezoneId: 'America/New_York',
        geolocation: { latitude: 40.7128, longitude: -74.006 },
        viewport: { width: 1280, height: 720 },
      },
      proxy: { source: 'raw-override', server: 'http://proxy.example:8080' },
    };
    const getSessionsForUser = jest.fn().mockReturnValue([
      ['p:dXNlcg:YWxwaGE:c2ln', { context: {}, tabGroups: new Map() }],
    ]);

    jest.doMock('../../dist/src/middleware/errors', () => ({
      safeError: (err) => (err instanceof Error ? err.message : String(err)),
    }));
    jest.doMock('../../dist/src/middleware/logging', () => ({ log: jest.fn() }));
    jest.doMock('../../dist/src/middleware/auth', () => ({ isAuthorizedWithApiKey: jest.fn().mockReturnValue(true) }));
    jest.doMock('../../dist/src/middleware/rate-limit', () => ({ checkRateLimit: jest.fn() }));
    jest.doMock('../../dist/src/utils/config', () => ({ loadConfig: () => ({ apiKey: '' }) }));
    jest.doMock('../../dist/src/utils/presets', () => ({
      getAllPresets: jest.fn().mockReturnValue({}),
      resolveContextOptions: jest.fn().mockReturnValue(null),
      validateContextOptions: jest.fn().mockReturnValue(null),
    }));
    jest.doMock('../../dist/src/services/context-pool', () => ({
      contextPool: {
        getEntry: jest.fn().mockReturnValue(undefined),
        listActiveUserIds: jest.fn().mockReturnValue([]),
        restartContext,
        setHeadlessOverride,
        size: jest.fn().mockReturnValue(0),
      },
      getDisplayForUser,
    }));
    jest.doMock('../../dist/src/services/lifecycle-controller', () => ({
      lifecycleController: { recordInteractiveActivity: jest.fn() },
    }));
    jest.doMock('../../dist/src/services/vnc', () => ({ startVnc, stopVnc }));
    jest.doMock('../../dist/src/services/session', () => ({
      MAX_TABS_PER_SESSION: 10,
      acquireFirstCreateMutex: jest.fn(),
      clearSessionProfile: jest.fn(),
      commitStagedFirstUse: jest.fn(),
      createCanonicalProfile: jest.fn(),
      createStagedSession: jest.fn(),
      establishSessionProfile: jest.fn(),
      findTabById: jest.fn(),
      getCanonicalProfile: jest.fn(),
      getEstablishedSessionProfile: jest.fn(),
      getSession: jest.fn(),
      getSessionMapKey: jest.fn(),
      getSessionProfileLaunchSettings: jest.fn().mockReturnValue(profileLaunchSettings),
      getSessionsForUser,
      getTabGroup: jest.fn(),
      indexTab: jest.fn(),
      normalizeUserId: (value) => String(value),
      rollbackCanonicalMutex: jest.fn(),
      rollbackStagedFirstUse: jest.fn(),
      unindexTab: jest.fn(),
      closeSessionsForUser,
      countTotalTabsForSessions: jest.fn().mockReturnValue(0),
      withUserLimit: jest.fn((_userId, _limit, operation) => operation()),
    }));
    jest.doMock('../../dist/src/services/tab', () => ({
      backTab: jest.fn(),
      buildSnapshotPayload: jest.fn(),
      buildRefs: jest.fn(),
      clickTab: jest.fn(),
      createTabState: jest.fn(),
      evaluateTab: jest.fn(),
      evaluateTabExtended: jest.fn(),
      forwardTab: jest.fn(),
      getLinks: jest.fn(),
      pressTab: jest.fn(),
      refreshTab: jest.fn(),
      screenshotTab: jest.fn(),
      scrollTab: jest.fn(),
      scrollElementTab: jest.fn(),
      snapshotTab: jest.fn(),
      calculateTypeTimeoutMs: jest.fn(),
      navigateWithSafetyGuard: jest.fn(),
      typeTab: jest.fn(),
      safePageClose: jest.fn(),
      validateNavigationUrl: jest.fn(),
      waitForPageReady: jest.fn(),
      withTimeout: jest.fn(),
      withTabLock: jest.fn(),
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
      startTracing: jest.fn(),
      stopTracing: jest.fn(),
      startTracingChunk: jest.fn(),
      stopTracingChunk: jest.fn(),
      getTracingState: jest.fn(),
      listTraceArtifacts: jest.fn().mockReturnValue([]),
      resolveTraceArtifactPath: jest.fn(),
      deleteTraceArtifact: jest.fn(),
    }));

    const express = require('express');
    const router = require('../../dist/src/routes/core').default;
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });

    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/sessions/user-a/toggle-display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: 'virtual' }),
      });

      expect(response.status).toBe(200);
      expect(restartContext).toHaveBeenCalledWith(
        'user-a',
        'virtual',
        'p:dXNlcg:YWxwaGE:c2ln',
        profileLaunchSettings.contextOverrides,
        profileLaunchSettings.proxy,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('stores display override without closing sessions when multiple profile contexts are active', async () => {
    jest.resetModules();

    const closeSessionsForUser = jest.fn().mockResolvedValue(undefined);
    const restartContext = jest.fn().mockResolvedValue({});
    const setHeadlessOverride = jest.fn();
    const getDisplayForUser = jest.fn();
    const startVnc = jest.fn();
    const stopVnc = jest.fn();
    const getSessionsForUser = jest.fn().mockReturnValue([
      ['p:dXNlcg:YWxwaGE:c2lnMQ', { context: {}, tabGroups: new Map() }],
      ['p:dXNlcg:YmV0YQ:c2lnMg', { context: {}, tabGroups: new Map() }],
    ]);

    jest.doMock('../../dist/src/middleware/errors', () => ({
      safeError: (err) => (err instanceof Error ? err.message : String(err)),
    }));
    jest.doMock('../../dist/src/middleware/logging', () => ({ log: jest.fn() }));
    jest.doMock('../../dist/src/middleware/auth', () => ({ isAuthorizedWithApiKey: jest.fn().mockReturnValue(true) }));
    jest.doMock('../../dist/src/middleware/rate-limit', () => ({ checkRateLimit: jest.fn() }));
    jest.doMock('../../dist/src/utils/config', () => ({ loadConfig: () => ({ apiKey: '' }) }));
    jest.doMock('../../dist/src/utils/presets', () => ({
      getAllPresets: jest.fn().mockReturnValue({}),
      resolveContextOptions: jest.fn().mockReturnValue(null),
      validateContextOptions: jest.fn().mockReturnValue(null),
    }));
    jest.doMock('../../dist/src/services/context-pool', () => ({
      contextPool: {
        getEntry: jest.fn(),
        listActiveUserIds: jest.fn().mockReturnValue([]),
        restartContext,
        setHeadlessOverride,
        size: jest.fn().mockReturnValue(0),
      },
      getDisplayForUser,
    }));
    jest.doMock('../../dist/src/services/lifecycle-controller', () => ({
      lifecycleController: { recordInteractiveActivity: jest.fn() },
    }));
    jest.doMock('../../dist/src/services/vnc', () => ({ startVnc, stopVnc }));
    jest.doMock('../../dist/src/services/session', () => ({
      MAX_TABS_PER_SESSION: 10,
      acquireFirstCreateMutex: jest.fn(),
      clearSessionProfile: jest.fn(),
      commitStagedFirstUse: jest.fn(),
      createCanonicalProfile: jest.fn(),
      createStagedSession: jest.fn(),
      establishSessionProfile: jest.fn(),
      findTabById: jest.fn(),
      getCanonicalProfile: jest.fn(),
      getEstablishedSessionProfile: jest.fn(),
      getSession: jest.fn(),
      getSessionMapKey: jest.fn(),
      getSessionsForUser,
      getTabGroup: jest.fn(),
      indexTab: jest.fn(),
      normalizeUserId: (value) => String(value),
      rollbackCanonicalMutex: jest.fn(),
      rollbackStagedFirstUse: jest.fn(),
      unindexTab: jest.fn(),
      closeSessionsForUser,
      countTotalTabsForSessions: jest.fn().mockReturnValue(0),
      withUserLimit: jest.fn((_userId, _limit, operation) => operation()),
    }));
    jest.doMock('../../dist/src/services/tab', () => ({
      backTab: jest.fn(),
      buildSnapshotPayload: jest.fn(),
      buildRefs: jest.fn(),
      clickTab: jest.fn(),
      createTabState: jest.fn(),
      evaluateTab: jest.fn(),
      evaluateTabExtended: jest.fn(),
      forwardTab: jest.fn(),
      getLinks: jest.fn(),
      pressTab: jest.fn(),
      refreshTab: jest.fn(),
      screenshotTab: jest.fn(),
      scrollTab: jest.fn(),
      scrollElementTab: jest.fn(),
      snapshotTab: jest.fn(),
      calculateTypeTimeoutMs: jest.fn(),
      navigateWithSafetyGuard: jest.fn(),
      typeTab: jest.fn(),
      safePageClose: jest.fn(),
      validateNavigationUrl: jest.fn(),
      waitForPageReady: jest.fn(),
      withTimeout: jest.fn(),
      withTabLock: jest.fn(),
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
      startTracing: jest.fn(),
      stopTracing: jest.fn(),
      startTracingChunk: jest.fn(),
      stopTracingChunk: jest.fn(),
      getTracingState: jest.fn(),
      listTraceArtifacts: jest.fn().mockReturnValue([]),
      resolveTraceArtifactPath: jest.fn(),
      deleteTraceArtifact: jest.fn(),
    }));

    const express = require('express');
    const router = require('../../dist/src/routes/core').default;
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });

    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/sessions/user-a/toggle-display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: 'virtual' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(closeSessionsForUser).not.toHaveBeenCalled();
      expect(restartContext).not.toHaveBeenCalled();
      expect(startVnc).not.toHaveBeenCalled();
      expect(setHeadlessOverride).toHaveBeenCalledWith('user-a', 'virtual');
      expect(body).toMatchObject({
        ok: true,
        headless: 'virtual',
        tabsInvalidated: false,
        userId: 'user-a',
      });
      expect(body.message).toContain('Existing tabs preserved');
      expect(body.message).not.toContain('Previous tabs invalidated');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
