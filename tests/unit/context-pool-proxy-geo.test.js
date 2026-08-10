/**
 * Unit test for context pool profileKey-based identity.
 * Verifies that ensureContext reuses contexts only when profileKey matches.
 */

// Mock config FIRST to set small maxSessions for eviction testing
jest.mock('../../dist/src/utils/config', () => ({
  loadConfig: jest.fn(() => ({
    maxSessions: 2, // Force small pool for eviction tests
    userDataDir: '/tmp/camofox-test',
    profilesDir: '/tmp/camofox-test/profiles',
    port: 3000,
    fingerprintDefaults: {},
    proxy: {
      host: '',
      port: '',
      username: '',
      password: '',
    },
  })),
}));

// Mock camoufox-js to avoid ESM import issues in Jest
jest.mock('camoufox-js', () => ({
  launchOptions: jest.fn(() => Promise.resolve({})),
}));

jest.mock('camoufox-js/dist/fingerprints.js', () => ({
  generateFingerprint: jest.fn(() => ({})),
}));

jest.mock('camoufox-js/dist/pkgman.js', () => ({
  installedVerStr: jest.fn(() => '1.0.0'),
}));

const mockLaunchPersistentContext = jest.fn(async () => {
  const mockContext = {
    pages: jest.fn(() => []),
    newPage: jest.fn(async () => ({})),
    close: jest.fn(async () => {}),
    on: jest.fn(),
  };
  return mockContext;
});

function defaultProfileKey(userId) {
  return `u:${Buffer.from(String(userId), 'utf16le').toString('base64url')}`;
}

// Mock playwright-core to avoid heavy browser dependencies
jest.mock('playwright-core', () => ({
  firefox: {
    launchPersistentContext: mockLaunchPersistentContext,
  },
}));

// Mock the sidecar and logging
jest.mock('../../dist/src/utils/sidecar-version', () => ({
  readVersionedSidecar: jest.fn(() => null),
  writeVersionedSidecar: jest.fn(),
}));

jest.mock('../../dist/src/middleware/logging', () => ({
  log: jest.fn(),
}));

describe('ContextPool proxy-geo identity', () => {
  let ContextPool;
  
  beforeAll(() => {
    // Import after mocks are set up
    ContextPool = require('../../dist/src/services/context-pool').ContextPool;
  });

  beforeEach(() => {
    mockLaunchPersistentContext.mockClear();
  });

  test('ensureContext reuses only identical profile signatures', async () => {
    const pool = new ContextPool();
    
    // First call with profileKey 'user-1::alpha::sig-a'
    const first = await pool.ensureContext(
      'user-1::alpha::sig-a',
      'user-1',
      { timezoneId: 'Asia/Tokyo' },
      { source: 'named-profile', server: 'http://proxy.alpha.test:8001', profileName: 'alpha' },
    );
    
    // Second call with same profileKey should reuse the context
    const second = await pool.ensureContext(
      'user-1::alpha::sig-a',
      'user-1',
      { timezoneId: 'Asia/Tokyo' },
      { source: 'named-profile', server: 'http://proxy.alpha.test:8001', profileName: 'alpha' },
    );
    
    // Third call with different profileKey should create new context
    const third = await pool.ensureContext(
      'user-1::beta::sig-b',
      'user-1',
      { timezoneId: 'Europe/Berlin' },
      { source: 'named-profile', server: 'http://proxy.beta.test:8002', profileName: 'beta' },
    );

    // Verify reuse behavior
    expect(second.context).toBe(first.context);
    expect(third.context).not.toBe(first.context);
    expect(second.profileKey).toBe('user-1::alpha::sig-a');
    expect(third.profileKey).toBe('user-1::beta::sig-b');

    // Cleanup
    await pool.closeContext('user-1::alpha::sig-a');
    await pool.closeContext('user-1::beta::sig-b');
  });

  test('pool tracks contexts by profileKey not just userId', async () => {
    const pool = new ContextPool();
    
    const alpha = await pool.ensureContext(
      'user-2::session-a::sig-x',
      'user-2',
      { timezoneId: 'America/New_York' },
    );
    
    const beta = await pool.ensureContext(
      'user-2::session-b::sig-y',
      'user-2',
      { timezoneId: 'Europe/London' },
    );

    // Both should exist with different profileKeys
    expect(alpha.profileKey).toBe('user-2::session-a::sig-x');
    expect(beta.profileKey).toBe('user-2::session-b::sig-y');
    expect(alpha.userId).toBe('user-2');
    expect(beta.userId).toBe('user-2');
    expect(alpha.context).not.toBe(beta.context);

    // Close one shouldn't affect the other
    await pool.closeContext('user-2::session-a::sig-x');
    
    const alphaEntry = pool.getEntry('user-2::session-a::sig-x');
    const betaEntry = pool.getEntry('user-2::session-b::sig-y');
    
    expect(alphaEntry).toBeUndefined();
    expect(betaEntry).toBeDefined();

    // Cleanup
    await pool.closeContext('user-2::session-b::sig-y');
  });

  test('profile-keyed sibling contexts use separate persistent profile directories', async () => {
    const pool = new ContextPool();

    await pool.ensureContext(
      'user-6::alpha::sig-a',
      'user-6',
      { timezoneId: 'Asia/Tokyo' },
      { source: 'named-profile', server: 'http://proxy.alpha.test:8001', profileName: 'alpha' },
    );

    await pool.ensureContext(
      'user-6::beta::sig-b',
      'user-6',
      { timezoneId: 'Europe/Berlin' },
      { source: 'named-profile', server: 'http://proxy.beta.test:8002', profileName: 'beta' },
    );

    const dirs = mockLaunchPersistentContext.mock.calls.map((call) => call[0]);
    expect(dirs).toContain('/tmp/camofox-test/profiles/user-6%3A%3Aalpha%3A%3Asig-a');
    expect(dirs).toContain('/tmp/camofox-test/profiles/user-6%3A%3Abeta%3A%3Asig-b');
    expect(new Set(dirs).size).toBe(2);

    await pool.closeContext('user-6::alpha::sig-a');
    await pool.closeContext('user-6::beta::sig-b');
  });

  test('restartContext prelaunches the encoded default profile key', async () => {
    const pool = new ContextPool();
    const userId = 'toggle::owner';
    const profileKey = defaultProfileKey(userId);

    const restarted = await pool.restartContext(userId, false, profileKey);

    expect(restarted.profileKey).toBe(profileKey);
    expect(pool.getEntry(profileKey)).toBe(restarted);
    expect(pool.getEntry(userId)).toBeUndefined();

    await pool.closeContext(profileKey);
  });

  test('encoded default profile keys keep the legacy raw-user persistent profile directory', async () => {
    const pool = new ContextPool();
    const userId = 'legacy::owner';
    const profileKey = defaultProfileKey(userId);

    const entry = await pool.ensureContext(profileKey, userId);

    expect(entry.profileDir).toBe('/tmp/camofox-test/profiles/legacy%3A%3Aowner');
    expect(mockLaunchPersistentContext).toHaveBeenCalledWith(
      '/tmp/camofox-test/profiles/legacy%3A%3Aowner',
      expect.any(Object),
    );

    await pool.closeContext(profileKey);
  });

  test('raw user IDs that look like internal profile keys cannot alias profile-key directories', async () => {
    const pool = new ContextPool();
    const craftedUserId = 'p:dmljdGlt:YWxwaGE:N2Y0OTBlN2M2ODBk';
    const craftedDefaultKey = defaultProfileKey(craftedUserId);

    const victim = await pool.ensureContext(craftedUserId, 'victim', { timezoneId: 'Asia/Tokyo' });
    const crafted = await pool.ensureContext(craftedDefaultKey, craftedUserId);

    expect(victim.profileDir).toBe('/tmp/camofox-test/profiles/p%3AdmljdGlt%3AYWxwaGE%3AN2Y0OTBlN2M2ODBk');
    expect(crafted.profileDir).toBe(`/tmp/camofox-test/profiles/${encodeURIComponent(craftedDefaultKey)}`);
    expect(crafted.profileDir).not.toBe(victim.profileDir);

    await pool.closeContext(craftedDefaultKey);
    await pool.closeContext(craftedUserId);
  });

  test('malformed UTF-16 default user IDs stay in encoded profile-key directories', async () => {
    const pool = new ContextPool();
    const loneSurrogateUserId = '\ud800';
    const replacementUserId = '\ufffd';
    const loneKey = defaultProfileKey(loneSurrogateUserId);
    const replacementKey = defaultProfileKey(replacementUserId);

    expect(loneKey).not.toBe(replacementKey);
    const lone = await pool.ensureContext(loneKey, loneSurrogateUserId);
    const replacement = await pool.ensureContext(replacementKey, replacementUserId);

    expect(lone.profileDir).toBe(`/tmp/camofox-test/profiles/${encodeURIComponent(loneKey)}`);
    expect(replacement.profileDir).toBe('/tmp/camofox-test/profiles/%EF%BF%BD');
    expect(lone.profileDir).not.toBe(replacement.profileDir);

    await pool.closeContext(loneKey);
    await pool.closeContext(replacementKey);
  });

  test('closeContext removes entry by profileKey not userId', async () => {
    const pool = new ContextPool();
    
    // Create 2 contexts for same user with different profileKeys
    const alpha = await pool.ensureContext(
      'user-3::alpha::sig-1',
      'user-3',
      { timezoneId: 'Asia/Tokyo' },
    );
    
    const beta = await pool.ensureContext(
      'user-3::beta::sig-2',
      'user-3',
      { timezoneId: 'Europe/Berlin' },
    );
    
    // Both should exist
    expect(pool.size()).toBe(2);
    expect(pool.getEntry('user-3::alpha::sig-1')).toBeDefined();
    expect(pool.getEntry('user-3::beta::sig-2')).toBeDefined();
    
    // Close by profileKey should remove only that specific entry
    await pool.closeContext('user-3::alpha::sig-1');
    
    // Verify alpha is gone but beta remains
    expect(pool.size()).toBe(1);
    expect(pool.getEntry('user-3::alpha::sig-1')).toBeUndefined();
    expect(pool.getEntry('user-3::beta::sig-2')).toBeDefined();
    
    // Cleanup
    await pool.closeContext('user-3::beta::sig-2');
  });

  test('evictIfNeeded evicts by profileKey not userId (regression for LRU bug)', async () => {
    const pool = new ContextPool();
    
    // maxSessions is mocked to 2, so pool can hold max 2 contexts
    // Create first context for user-4 with profileKey alpha
    const alpha = await pool.ensureContext(
      'user-4::alpha::sig-a',
      'user-4',
      { timezoneId: 'Asia/Tokyo' },
    );
    
    // Create second context for same user-4 with different profileKey beta
    // Pool is now at capacity (2/2)
    const beta = await pool.ensureContext(
      'user-4::beta::sig-b',
      'user-4',
      { timezoneId: 'Europe/Berlin' },
    );
    
    // Both should exist, pool at max capacity
    expect(pool.size()).toBe(2);
    expect(pool.getEntry('user-4::alpha::sig-a')).toBeDefined();
    expect(pool.getEntry('user-4::beta::sig-b')).toBeDefined();
    
    // Touch beta to make alpha the LRU
    pool.getEntry('user-4::beta::sig-b');
    
    // Create third context for different user
    // This should trigger eviction of LRU (user-4::alpha::sig-a)
    // Before fix (184384d): evictIfNeeded called closeContext(lru.userId) = closeContext('user-4')
    // which wouldn't match 'user-4::alpha::sig-a' or 'user-4::beta::sig-b', so eviction failed
    // After fix: evictIfNeeded calls closeContext(lru.profileKey) = closeContext('user-4::alpha::sig-a')
    // which correctly evicts the LRU entry
    const gamma = await pool.ensureContext(
      'user-5::gamma::sig-c',
      'user-5',
      { timezoneId: 'America/New_York' },
    );
    
    // Verify eviction worked correctly:
    // - Pool stayed at max size (2)
    // - LRU profileKey (alpha) was evicted
    // - Sibling profileKey (beta) for same userId survived
    // - New context (gamma) was added
    expect(pool.size()).toBe(2);
    expect(pool.getEntry('user-4::alpha::sig-a')).toBeUndefined(); // LRU evicted
    expect(pool.getEntry('user-4::beta::sig-b')).toBeDefined();    // Sibling survived
    expect(pool.getEntry('user-5::gamma::sig-c')).toBeDefined();   // New entry added
    
    // Cleanup
    await pool.closeContext('user-4::beta::sig-b');
    await pool.closeContext('user-5::gamma::sig-c');
  });
});
