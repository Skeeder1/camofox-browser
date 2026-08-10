const {
  startServer,
  stopServer,
  getServerUrl,
  getServerLogs,
  clearServerLogs,
} = require('../helpers/startServer');
const { startTestSite, stopTestSite, getTestSiteUrl } = require('../helpers/testSite');
const { createClient } = require('../helpers/client');

describe('Snapshot parity', () => {
  let serverUrl;
  let testSiteUrl;

  beforeAll(async () => {
    await startServer();
    serverUrl = getServerUrl();

    await startTestSite();
    testSiteUrl = getTestSiteUrl();
  }, 120000);

  afterAll(async () => {
    await stopTestSite();
    await stopServer();
  }, 30000);

  test('core snapshot includes plugin-advertised pagination metadata', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/pageA`);
      const snapshot = await client.getSnapshot(tabId);

      expect(snapshot).toEqual(expect.objectContaining({
        url: expect.stringContaining('/pageA'),
        snapshot: expect.any(String),
        refsCount: expect.any(Number),
        offset: 0,
        truncated: false,
        totalChars: expect.any(Number),
        hasMore: false,
        nextOffset: null,
      }));
      expect(snapshot.totalChars).toBe(snapshot.snapshot.length);
    } finally {
      await client.cleanup();
    }
  });

  test('openclaw snapshot includes pagination metadata with envelope', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/pageA`);
      const snapshot = await client.request(
        'GET',
        `/snapshot?targetId=${encodeURIComponent(tabId)}&userId=${encodeURIComponent(client.userId)}`,
      );

      expect(snapshot).toEqual(expect.objectContaining({
        ok: true,
        format: 'aria',
        targetId: tabId,
        url: expect.stringContaining('/pageA'),
        snapshot: expect.any(String),
        refsCount: expect.any(Number),
        offset: 0,
        truncated: false,
        totalChars: expect.any(Number),
        hasMore: false,
        nextOffset: null,
      }));
    } finally {
      await client.cleanup();
    }
  });

  test('core and openclaw return consistent pagination fields', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/pageA`);
      const coreSnapshot = await client.getSnapshot(tabId);
      const openclawSnapshot = await client.request(
        'GET',
        `/snapshot?targetId=${encodeURIComponent(tabId)}&userId=${encodeURIComponent(client.userId)}`,
      );

      expect(coreSnapshot.totalChars).toBe(openclawSnapshot.totalChars);
      expect(coreSnapshot.refsCount).toBe(openclawSnapshot.refsCount);
      expect(coreSnapshot.truncated).toBe(openclawSnapshot.truncated);
      expect(coreSnapshot.offset).toBe(openclawSnapshot.offset);
      expect(coreSnapshot.hasMore).toBe(openclawSnapshot.hasMore);
      expect(coreSnapshot.nextOffset).toBe(openclawSnapshot.nextOffset);
    } finally {
      await client.cleanup();
    }
  });

  test('offset parameter is normalized consistently and applied by both snapshot routes', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/long-snapshot`);
      const firstSnapshot = await client.getSnapshot(tabId);

      expect(firstSnapshot.truncated).toBe(true);
      expect(firstSnapshot.hasMore).toBe(true);
      expect(typeof firstSnapshot.nextOffset).toBe('number');

      const invalidCore = await client.request(
        'GET',
        `/tabs/${tabId}/snapshot?userId=${encodeURIComponent(client.userId)}&offset=abc`,
      );
      const negativeCore = await client.request(
        'GET',
        `/tabs/${tabId}/snapshot?userId=${encodeURIComponent(client.userId)}&offset=-10`,
      );
      const pagedCore = await client.request(
        'GET',
        `/tabs/${tabId}/snapshot?userId=${encodeURIComponent(client.userId)}&offset=${firstSnapshot.nextOffset}`,
      );
      const pagedOpenclaw = await client.request(
        'GET',
        `/snapshot?targetId=${encodeURIComponent(tabId)}&userId=${encodeURIComponent(client.userId)}&offset=${firstSnapshot.nextOffset}`,
      );

      expect(invalidCore.offset).toBe(0);
      expect(negativeCore.offset).toBe(0);
      expect(pagedCore.offset).toBe(firstSnapshot.nextOffset);
      expect(pagedOpenclaw.offset).toBe(firstSnapshot.nextOffset);
      expect(pagedCore.totalChars).toBe(firstSnapshot.totalChars);
      expect(pagedOpenclaw.totalChars).toBe(firstSnapshot.totalChars);
      expect(pagedCore.truncated).toBe(true);
      expect(pagedCore.refsCount).toBe(pagedOpenclaw.refsCount);
    } finally {
      await client.cleanup();
    }
  });

  test('openclaw snapshot normalizes invalid and negative offsets to zero', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/long-snapshot`);

      const invalidOpenclaw = await client.request(
        'GET',
        `/snapshot?targetId=${encodeURIComponent(tabId)}&userId=${encodeURIComponent(client.userId)}&offset=abc`,
      );
      const negativeOpenclaw = await client.request(
        'GET',
        `/snapshot?targetId=${encodeURIComponent(tabId)}&userId=${encodeURIComponent(client.userId)}&offset=-10`,
      );

      expect(invalidOpenclaw.offset).toBe(0);
      expect(negativeOpenclaw.offset).toBe(0);
      expect(invalidOpenclaw.ok).toBe(true);
      expect(negativeOpenclaw.ok).toBe(true);
    } finally {
      await client.cleanup();
    }
  });

  test('terminal page and overrun offset return hasMore=false with nextOffset=null', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/long-snapshot`);
      const first = await client.getSnapshot(tabId);

      expect(first.truncated).toBe(true);
      expect(first.hasMore).toBe(true);
      expect(typeof first.nextOffset).toBe('number');

      let current = first;
      let iterations = 0;
      while (current.hasMore && iterations < 20) {
        current = await client.request(
          'GET',
          `/tabs/${tabId}/snapshot?userId=${encodeURIComponent(client.userId)}&offset=${current.nextOffset}`,
        );
        iterations++;
      }

      expect(current.hasMore).toBe(false);
      expect(current.nextOffset).toBeNull();
      expect(current.truncated).toBe(true);
      expect(current.totalChars).toBe(first.totalChars);

      const overrun = await client.request(
        'GET',
        `/tabs/${tabId}/snapshot?userId=${encodeURIComponent(client.userId)}&offset=${first.totalChars * 2}`,
      );
      expect(overrun.hasMore).toBe(false);
      expect(overrun.nextOffset).toBeNull();
      expect(overrun.truncated).toBe(true);
      expect(overrun.offset).toBeLessThanOrEqual(first.totalChars);

      const overrunOC = await client.request(
        'GET',
        `/snapshot?targetId=${encodeURIComponent(tabId)}&userId=${encodeURIComponent(client.userId)}&offset=${first.totalChars * 2}`,
      );
      expect(overrunOC.hasMore).toBe(false);
      expect(overrunOC.nextOffset).toBeNull();
    } finally {
      await client.cleanup();
    }
  });

  test('core snapshot logs metadata without the snapshot body', async () => {
    const client = createClient(serverUrl);

    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/pageA`);

      clearServerLogs();
      const snapshot = await client.getSnapshot(tabId);
      const snapshotLog = getServerLogs().find((line) => line.includes('"msg":"snapshot"'));

      expect(snapshotLog).toBeDefined();
      expect(snapshotLog).toContain('"snapshotLen"');
      expect(snapshotLog).not.toContain('"snapshot":');
      expect(snapshotLog).not.toContain(snapshot.snapshot);
      expect(snapshotLog).not.toContain('Welcome to Page A');
    } finally {
      await client.cleanup();
    }
  });
});

describe('OpenClaw snapshot limiter proof', () => {
  let limiterServerUrl;
  let limiterTestSiteUrl;
  let previousApiKey;

  beforeAll(async () => {
    previousApiKey = process.env.CAMOFOX_API_KEY;
    process.env.CAMOFOX_API_KEY = 'test-limiter-key';
    await startServer(0, { MAX_CONCURRENT_PER_USER: '1', CAMOFOX_API_KEY: 'test-limiter-key' });
    limiterServerUrl = getServerUrl();

    await startTestSite();
    limiterTestSiteUrl = getTestSiteUrl();
  }, 120000);

  afterAll(async () => {
    await stopTestSite();
    await stopServer();
    if (previousApiKey === undefined) {
      delete process.env.CAMOFOX_API_KEY;
    } else {
      process.env.CAMOFOX_API_KEY = previousApiKey;
    }
  }, 30000);

  test('openclaw snapshot queues behind a slow operation when limiter slot is held', async () => {
    const client = createClient(limiterServerUrl);

    try {
      const { tabId } = await client.createTab(`${limiterTestSiteUrl}/pageA`);

      // Fire a slow evaluate-extended that holds the single limiter slot for ~2s
      const slowEval = fetch(`${limiterServerUrl}/tabs/${tabId}/evaluate-extended`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-limiter-key',
        },
        body: JSON.stringify({
          userId: client.userId,
          expression: 'new Promise(r => setTimeout(r, 2000))',
          timeout: 5000,
        }),
      });

      // Give the eval a moment to acquire the limiter slot
      await new Promise((r) => setTimeout(r, 200));

      // Fire OpenClaw /snapshot while the slot is held
      const snapshotStart = Date.now();
      const snapshotRes = await client.request(
        'GET',
        `/snapshot?targetId=${encodeURIComponent(tabId)}&userId=${encodeURIComponent(client.userId)}`,
      );
      const snapshotMs = Date.now() - snapshotStart;

      // Snapshot must succeed
      expect(snapshotRes.ok).toBe(true);
      expect(snapshotRes.snapshot).toBeDefined();

      // KEY ASSERTION: If withUserLimit gates the OpenClaw route, the snapshot
      // waited for the eval to release the slot (~2s). Without withUserLimit,
      // the snapshot would return in <500ms.
      expect(snapshotMs).toBeGreaterThan(1000);

      // Clean up the eval request
      await slowEval;
    } finally {
      await client.cleanup();
    }
  }, 30000);
});