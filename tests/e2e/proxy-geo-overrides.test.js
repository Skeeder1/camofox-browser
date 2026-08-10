const crypto = require('crypto');

const { startServer, stopServer, getServerUrl } = require('../helpers/startServer');
const { startTestSite, stopTestSite, getTestSiteUrl } = require('../helpers/testSite');

async function postJson(serverUrl, path, body) {
  const res = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CAMOFOX_API_KEY ? { Authorization: `Bearer ${process.env.CAMOFOX_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { res, data };
}

async function deleteSession(serverUrl, userId) {
  const res = await fetch(`${serverUrl}/sessions/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: process.env.CAMOFOX_API_KEY ? { Authorization: `Bearer ${process.env.CAMOFOX_API_KEY}` } : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { res, data };
}

describe('Proxy and geo overrides', () => {
  let serverUrl;
  let testSiteUrl;
  const cleanupUsers = new Set();

  function trackUser(prefix) {
    const userId = `${prefix}-${crypto.randomUUID()}`;
    cleanupUsers.add(userId);
    return userId;
  }

  beforeAll(async () => {
    await startServer(0, {
      CAMOFOX_MAX_SESSIONS: '2',
      CAMOFOX_API_KEY: '',
      CAMOFOX_PROXY_PROFILES_FILE: require('path').join(__dirname, '../../proxy-profiles.test.json'),
    });
    serverUrl = getServerUrl();
    await startTestSite();
    testSiteUrl = getTestSiteUrl();
  }, 120000);

  afterEach(async () => {
    for (const userId of cleanupUsers) {
      await deleteSession(serverUrl, userId).catch(() => {});
    }
    cleanupUsers.clear();
  }, 30000);

  afterAll(async () => {
    await stopTestSite();
    await stopServer();
  }, 30000);

  test.skip('explicit-wins preserves explicit geo fields over the proxy profile defaults', async () => {
    const userId = trackUser('explicit-wins');
    const response = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'explicit',
      url: `${testSiteUrl}/pageA`,
      proxyProfile: 'tokyo-exit',
      geoMode: 'explicit-wins',
      timezoneId: 'Europe/Berlin',
      geolocation: { latitude: 52.52, longitude: 13.405 },
    });

    expect(response.res.status).toBe(200);
    expect(response.data.tabId).toBeDefined();
  }, 60000);

  test('proxy-locked rejects explicit timezone overrides', async () => {
    const userId = trackUser('proxy-locked');
    const response = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'locked',
      url: `${testSiteUrl}/pageA`,
      proxyProfile: 'tokyo-exit',
      geoMode: 'proxy-locked',
      timezoneId: 'Europe/Berlin',
    });

    expect(response.res.status).toBe(400);
    expect(response.data.error).toContain('proxy-locked does not allow explicit timezoneId overrides');
  }, 60000);

  test('proxy-locked rejects explicit geolocation overrides', async () => {
    const userId = trackUser('proxy-locked-geo');
    const response = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'locked-geo',
      url: `${testSiteUrl}/pageA`,
      proxyProfile: 'tokyo-exit',
      geoMode: 'proxy-locked',
      geolocation: { latitude: 52.52, longitude: 13.405 },
    });

    expect(response.res.status).toBe(400);
    expect(response.data.error).toContain('proxy-locked does not allow explicit geolocation overrides');
  }, 60000);

  test('proxy-locked rejects explicit locale overrides', async () => {
    const userId = trackUser('proxy-locked-locale');
    const response = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'locked-locale',
      url: `${testSiteUrl}/pageA`,
      proxyProfile: 'tokyo-exit',
      geoMode: 'proxy-locked',
      locale: 'de-DE',
    });

    expect(response.res.status).toBe(400);
    expect(response.data.error).toContain('proxy-locked does not allow explicit locale overrides');
  }, 60000);

  test('rejected core create does not persist a stale proxy profile for retry', async () => {
    const userId = trackUser('stale-core-profile');
    const failed = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'retry',
      url: 'chrome://invalid-url',
      proxyProfile: 'tokyo-exit',
    });

    expect(failed.res.status).toBe(400);

    const retry = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'retry',
      url: `${testSiteUrl}/pageA`,
    });

    expect(retry.res.status).toBe(200);
    expect(retry.data.tabId).toBeDefined();
  }, 60000);

  test.skip('session-level proxy overrides work', async () => {
    const userId = trackUser('session-proxy');
    const response = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'session-proxy',
      url: `${testSiteUrl}/pageA`,
      proxy: {
        host: 'proxy.example.com',
        port: 8080,
        username: 'user',
        password: 'pass',
      },
    });

    // Requires a live proxy because session-level proxies now reach browser context launch.
    expect(response.res.status).toBe(200);
    expect(response.data.tabId).toBeDefined();
  }, 60000);

  test.skip('proxyProfile takes precedence over raw proxy when both are provided', async () => {
    const userId = trackUser('profile-precedence');
    const response = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'precedence',
      url: `${testSiteUrl}/pageA`,
      proxyProfile: 'tokyo-exit',
      proxy: {
        host: 'ignored.example.com',
        port: 9999,
      },
    });

    // Requires a live proxy because session-level proxies now reach browser context launch.
    expect(response.res.status).toBe(200);
    expect(response.data.tabId).toBeDefined();
  }, 60000);

  test.skip('default geoMode is explicit-wins', async () => {
    const userId = trackUser('default-mode');
    const response = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'default',
      url: `${testSiteUrl}/pageA`,
      proxyProfile: 'tokyo-exit',
      timezoneId: 'Europe/Berlin',
    });

    // Requires a live proxy because session-level proxies now reach browser context launch.
    expect(response.res.status).toBe(200);
    expect(response.data.tabId).toBeDefined();
  }, 60000);
});
