const { startServer, stopServer, getServerUrl } = require('../helpers/startServer');

describe('OpenAPI/Docs Endpoints', () => {
  let serverUrl;
  
  beforeAll(async () => {
    await startServer();
    serverUrl = getServerUrl();
  }, 120000);
  
  afterAll(async () => {
    await stopServer();
  }, 30000);
  
  describe('GET /openapi.json', () => {
    test('returns 200 with valid OpenAPI 3.1.0 spec', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const spec = await response.json();
      
      // Verify OpenAPI version
      expect(spec.openapi).toBe('3.1.0');
      
      // Verify basic structure
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBeDefined();
      expect(spec.info.version).toBeDefined();
      expect(spec.paths).toBeDefined();
      expect(typeof spec.paths).toBe('object');
      
      // Verify representative core routes are documented
      expect(spec.paths['/health']).toBeDefined();
      expect(spec.paths['/presets']).toBeDefined();
      expect(spec.paths['/tabs']).toBeDefined();
      expect(spec.paths['/tabs/{tabId}/navigate']).toBeDefined();
      expect(spec.paths['/tabs/{tabId}/snapshot']).toBeDefined();
      expect(spec.paths['/tabs/{tabId}/click']).toBeDefined();
      
      // Verify representative OpenClaw routes are documented
      expect(spec.paths['/tabs/open']).toBeDefined();
      expect(spec.paths['/navigate']).toBeDefined();
      expect(spec.paths['/snapshot']).toBeDefined();
      expect(spec.paths['/stop']).toBeDefined();
    });
    
    test('spec includes security schemes', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      // Verify security schemes are defined
      expect(spec.components.securitySchemes).toBeDefined();
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
      expect(spec.components.securitySchemes.bearerAuth.type).toBe('http');
      expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
      
      expect(spec.components.securitySchemes.adminKey).toBeDefined();
      expect(spec.components.securitySchemes.adminKey.type).toBe('apiKey');
      expect(spec.components.securitySchemes.adminKey.in).toBe('header');
      expect(spec.components.securitySchemes.adminKey.name).toBe('X-Admin-Key');
    });

    test('spec uses a relative server URL for the current deployment root', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();

      expect(spec.servers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: '.',
          }),
        ]),
      );
    });
    
    test('protected routes have security requirements', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      // Verify bearer auth is required for API-protected routes
      expect(spec.paths['/tabs/{tabId}/navigate'].post.security).toEqual([{ bearerAuth: [] }]);
      expect(spec.paths['/tabs/open'].post.security).toEqual([{ bearerAuth: [] }]);
      expect(spec.paths['/navigate'].post.security).toEqual([{ bearerAuth: [] }]);
      
      // Verify admin key is required for stop route
      expect(spec.paths['/stop'].post.security).toEqual([{ adminKey: [] }]);
    });
    
    test('response shapes match actual handlers for /health', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const healthResponse = spec.paths['/health'].get.responses['200'];
      const schema = healthResponse.content['application/json'].schema;
      
      // Verify required fields match actual handler
      expect(schema.required).toContain('ok');
      expect(schema.required).toContain('running');
      expect(schema.required).toContain('engine');
      expect(schema.required).toContain('version');
      expect(schema.required).toContain('browserConnected');
      expect(schema.required).toContain('poolSize');
      expect(schema.required).toContain('activeUserIds');
      expect(schema.required).toContain('profileDirsTotal');
      
      // Verify properties match actual handler
      expect(schema.properties.ok.type).toBe('boolean');
      expect(schema.properties.running.type).toBe('boolean');
      expect(schema.properties.engine.type).toBe('string');
      expect(schema.properties.version.type).toBe('string');
      expect(schema.properties.browserConnected.type).toBe('boolean');
      expect(schema.properties.poolSize.type).toBe('number');
      expect(schema.properties.activeUserIds.type).toBe('array');
      expect(schema.properties.profileDirsTotal.type).toBe('number');
    });
    
    test('response shapes match actual handlers for /presets', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const presetsResponse = spec.paths['/presets'].get.responses['200'];
      const schema = presetsResponse.content['application/json'].schema;
      
      // Verify presets is required and is an object
      expect(schema.required).toContain('presets');
      expect(schema.properties.presets.type).toBe('object');
      
      // Verify preset structure includes locale, timezoneId, geolocation
      const presetSchema = schema.properties.presets.additionalProperties;
      expect(presetSchema.properties.locale).toBeDefined();
      expect(presetSchema.properties.timezoneId).toBeDefined();
      expect(presetSchema.properties.geolocation).toBeDefined();
    });
    
    test('response shapes match actual handlers for /tabs', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const tabsResponse = spec.paths['/tabs'].get.responses['200'];
      const schema = tabsResponse.content['application/json'].schema;
      
      // Verify required fields
      expect(schema.required).toContain('running');
      expect(schema.required).toContain('tabs');
      
      // Verify tab item structure matches actual handler
      const tabItemSchema = schema.properties.tabs.items;
      expect(tabItemSchema.required).toContain('targetId');
      expect(tabItemSchema.required).toContain('tabId');
      expect(tabItemSchema.required).toContain('url');
      expect(tabItemSchema.required).toContain('title');
      expect(tabItemSchema.required).toContain('listItemId');
    });
    
    test('response shapes match actual handlers for /tabs/open', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const openResponse = spec.paths['/tabs/open'].post.responses['200'];
      const schema = openResponse.content['application/json'].schema;
      
      // Verify required fields match actual handler
      expect(schema.required).toContain('ok');
      expect(schema.required).toContain('targetId');
      expect(schema.required).toContain('tabId');
      expect(schema.required).toContain('url');
      expect(schema.required).toContain('title');
      
      // Verify request body requires url and userId
      const requestSchema = spec.paths['/tabs/open'].post.requestBody.content['application/json'].schema;
      expect(requestSchema.required).toContain('url');
      expect(requestSchema.required).toContain('userId');
    });
    
    test('response shapes match actual handlers for core /tabs/{tabId}/navigate', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const navigateResponse = spec.paths['/tabs/{tabId}/navigate'].post.responses['200'];
      const schema = navigateResponse.content['application/json'].schema;
      
      // Core navigate returns only { ok, url } - no targetId, no title, no status
      expect(schema.required).toEqual(['ok', 'url']);
      expect(schema.properties.ok).toBeDefined();
      expect(schema.properties.url).toBeDefined();
      
      // Verify no extra fields that handler doesn't return
      expect(Object.keys(schema.properties)).toHaveLength(2);
      expect(schema.properties.targetId).toBeUndefined();
      expect(schema.properties.title).toBeUndefined();
      expect(schema.properties.status).toBeUndefined();
    });
    
    test('response shapes match actual handlers for OpenClaw /navigate', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const navigateResponse = spec.paths['/navigate'].post.responses['200'];
      const schema = navigateResponse.content['application/json'].schema;
      
      // OpenClaw navigate returns { ok, targetId, url } - no title, no status
      expect(schema.required).toEqual(['ok', 'targetId', 'url']);
      expect(schema.properties.ok).toBeDefined();
      expect(schema.properties.targetId).toBeDefined();
      expect(schema.properties.url).toBeDefined();
      
      // Verify no extra fields that handler doesn't return
      expect(Object.keys(schema.properties)).toHaveLength(3);
      expect(schema.properties.title).toBeUndefined();
      expect(schema.properties.status).toBeUndefined();
    });
    
    test('response shapes match actual handlers for /tabs/{tabId}/click', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const clickResponse = spec.paths['/tabs/{tabId}/click'].post.responses['200'];
      const schema = clickResponse.content['application/json'].schema;
      
      // Click returns { ok, url, downloads? }
      expect(schema.required).toEqual(['ok', 'url']);
      expect(schema.properties.ok).toBeDefined();
      expect(schema.properties.url).toBeDefined();
      expect(schema.properties.downloads).toBeDefined();
      expect(schema.properties.downloads.type).toBe('array');
      
      // Verify downloads array item structure
      const downloadItem = schema.properties.downloads.items;
      expect(downloadItem.required).toEqual(['id', 'filename', 'status', 'size']);
      expect(downloadItem.properties.id).toBeDefined();
      expect(downloadItem.properties.filename).toBeDefined();
      expect(downloadItem.properties.status).toBeDefined();
      expect(downloadItem.properties.size).toBeDefined();
      
      // Verify security is required
      expect(spec.paths['/tabs/{tabId}/click'].post.security).toEqual([{ bearerAuth: [] }]);
    });
    
    test('response shapes match actual handlers for core /tabs/{tabId}/snapshot', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const snapshotResponse = spec.paths['/tabs/{tabId}/snapshot'].get.responses['200'];
      const schema = snapshotResponse.content['application/json'].schema;
      
      // Core snapshot returns buildSnapshotPayload: { url, snapshot, refsCount, offset, truncated, totalChars, hasMore, nextOffset }
      expect(schema.required).toEqual(['url', 'snapshot', 'refsCount', 'offset', 'truncated', 'totalChars', 'hasMore', 'nextOffset']);
      expect(schema.properties.url).toBeDefined();
      expect(schema.properties.snapshot).toBeDefined();
      expect(schema.properties.refsCount).toBeDefined();
      expect(schema.properties.offset).toBeDefined();
      expect(schema.properties.truncated).toBeDefined();
      expect(schema.properties.totalChars).toBeDefined();
      expect(schema.properties.hasMore).toBeDefined();
      expect(schema.properties.nextOffset).toBeDefined();
      
      // Verify no invented fields like ok or title
      expect(Object.keys(schema.properties)).toHaveLength(8);
      expect(schema.properties.ok).toBeUndefined();
      expect(schema.properties.title).toBeUndefined();
      expect(schema.properties.nextOffset.anyOf).toEqual([{ type: 'number' }, { enum: [null] }]);
      expect(schema.properties.nextOffset.nullable).toBeUndefined();
    });
    
    test('response shapes match actual handlers for OpenClaw /snapshot', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      const snapshotResponse = spec.paths['/snapshot'].get.responses['200'];
      const schema = snapshotResponse.content['application/json'].schema;
      
      // OpenClaw snapshot returns { ok, format, targetId, ...buildSnapshotPayload(...) }
      expect(schema.required).toEqual(['ok', 'format', 'targetId', 'url', 'snapshot', 'refsCount', 'offset', 'truncated', 'totalChars', 'hasMore', 'nextOffset']);
      expect(schema.properties.ok).toBeDefined();
      expect(schema.properties.format).toBeDefined();
      expect(schema.properties.format.enum).toEqual(['aria']);
      expect(schema.properties.targetId).toBeDefined();
      
      // Plus all buildSnapshotPayload fields
      expect(schema.properties.url).toBeDefined();
      expect(schema.properties.snapshot).toBeDefined();
      expect(schema.properties.refsCount).toBeDefined();
      expect(schema.properties.offset).toBeDefined();
      expect(schema.properties.truncated).toBeDefined();
      expect(schema.properties.totalChars).toBeDefined();
      expect(schema.properties.hasMore).toBeDefined();
      expect(schema.properties.nextOffset).toBeDefined();
      
      // Verify no invented title field
      expect(Object.keys(schema.properties)).toHaveLength(11);
      expect(schema.properties.title).toBeUndefined();
      expect(schema.properties.nextOffset.anyOf).toEqual([{ type: 'number' }, { enum: [null] }]);
      expect(schema.properties.nextOffset.nullable).toBeUndefined();
    });
    
    test('spec includes components and schemas', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      // Verify components section exists
      expect(spec.components).toBeDefined();
      expect(spec.components.schemas).toBeDefined();
      
      // Verify some key schemas are defined
      expect(spec.components.schemas.TabState).toBeDefined();
      expect(spec.components.schemas.GeolocationConfig).toBeDefined();
    });
    
    test('request schemas require userId for authenticated routes', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      // POST /tabs/{tabId}/navigate requires userId
      const navigateReq = spec.paths['/tabs/{tabId}/navigate'].post.requestBody;
      const navigateSchema = navigateReq.content['application/json'].schema;
      expect(navigateSchema.required).toContain('userId');
      
      // POST /tabs/{tabId}/click requires userId
      const clickReq = spec.paths['/tabs/{tabId}/click'].post.requestBody;
      const clickSchema = clickReq.content['application/json'].schema;
      expect(clickSchema.required).toContain('userId');
      
      // POST /navigate (OpenClaw) requires userId
      const openclawNavReq = spec.paths['/navigate'].post.requestBody;
      const openclawNavSchema = openclawNavReq.content['application/json'].schema;
      expect(openclawNavSchema.required).toContain('userId');
      expect(openclawNavSchema.required).toContain('targetId');
    });
    
    test('request schemas document either/or field requirements', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      // POST /tabs/{tabId}/navigate requires either url or macro
      const navigateSchema = spec.paths['/tabs/{tabId}/navigate'].post.requestBody.content['application/json'].schema;
      const navigateDesc = spec.paths['/tabs/{tabId}/navigate'].post.description;
      expect(navigateDesc).toContain('Either url or macro is required');
      expect(navigateSchema.anyOf).toEqual([{ required: ['url'] }, { required: ['macro'] }]);
      
      // POST /tabs/{tabId}/click requires either ref or selector
      const clickSchema = spec.paths['/tabs/{tabId}/click'].post.requestBody.content['application/json'].schema;
      const clickDesc = spec.paths['/tabs/{tabId}/click'].post.description;
      expect(clickDesc).toContain('Either ref or selector is required');
      expect(clickSchema.anyOf).toEqual([{ required: ['ref'] }, { required: ['selector'] }]);
      
      // POST /navigate (OpenClaw) requires either url or macro
      const openclawNavSchema = spec.paths['/navigate'].post.requestBody.content['application/json'].schema;
      const openclawNavDesc = spec.paths['/navigate'].post.description;
      expect(openclawNavDesc).toContain('Either url or macro is required');
      expect(openclawNavSchema.anyOf).toEqual([{ required: ['url'] }, { required: ['macro'] }]);
    });
    
    test('/act path is absent from spec', async () => {
      const response = await fetch(`${serverUrl}/openapi.json`);
      const spec = await response.json();
      
      // /act should not be documented (polymorphic, out of scope)
      expect(spec.paths['/act']).toBeUndefined();
    });
  });
  
  describe('GET /api/docs', () => {
    test('returns 200 with HTML Swagger UI', async () => {
      const response = await fetch(`${serverUrl}/api/docs`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      
      const html = await response.text();
      
      // Verify Swagger UI is present
      expect(html).toContain('swagger-ui');
      expect(html.toLowerCase()).toContain('swagger');
    });

    test('Swagger UI bootstraps from a relative OpenAPI URL', async () => {
      const response = await fetch(`${serverUrl}/api/docs/swagger-ui-init.js`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('javascript');

      const initScript = await response.text();
      expect(initScript).toContain('../openapi.json');
    });
  });
});
