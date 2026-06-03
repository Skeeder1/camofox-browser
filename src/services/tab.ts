import type { Locator, Page } from 'playwright-core';

import { isElementRef as isSelectorElementRef } from '../cli/utils/selector';
import { expandMacro } from '../utils/macros';
import type {
	ConsoleEntry,
	EvaluateResult,
	PageErrorEntry,
	RefInfo,
	ScrollPosition,
	TabState,
	WaitForPageReadyOptions,
} from '../types';
import { log } from '../middleware/logging';

const ALLOWED_URL_SCHEMES: ReadonlyArray<'http:' | 'https:'> = ['http:', 'https:'];

// Selective set of actionable roles worth indexing as refs.
const INTERACTIVE_ROLES: ReadonlyArray<string> = [
	'button',
	'link',
	'textbox',
	'checkbox',
	'radio',
	'menuitem',
	'tab',
	'searchbox',
	'slider',
	'spinbutton',
	'switch',
	'combobox',
	'listbox',
	'option',
	'select',
	'dialog',
	'alertdialog',
	'gridcell',
	'treeitem',
];

// Patterns to skip (date pickers, calendar widgets)
const SKIP_PATTERNS: ReadonlyArray<RegExp> = [/date/i, /calendar/i, /picker/i, /datepicker/i];

const DEFAULT_MAX_SNAPSHOT_NODES = 2000;
const parsedMaxSnapshotNodes = Number.parseInt(
	process.env.CAMOFOX_MAX_SNAPSHOT_NODES || String(DEFAULT_MAX_SNAPSHOT_NODES),
	10,
);
const MAX_SNAPSHOT_NODES = Number.isFinite(parsedMaxSnapshotNodes) && parsedMaxSnapshotNodes > 0
	? parsedMaxSnapshotNodes
	: DEFAULT_MAX_SNAPSHOT_NODES;

const MAX_EVAL_TIMEOUT = 300000;
const DEFAULT_EVAL_TIMEOUT = 5000;
const MAX_EVAL_EXTENDED_TIMEOUT = 300000;
const DEFAULT_EVAL_EXTENDED_TIMEOUT = 30000;
const MAX_RESULT_SIZE = 1048576; // 1MB
const CONSOLE_BUFFER_SIZE = Math.max(100, parseInt(process.env.CAMOFOX_CONSOLE_BUFFER_SIZE || '1000', 10));

export const LONG_TEXT_THRESHOLD = 400;
export const TYPE_TIMEOUT_BASE_MS = 10000;
export const TYPE_TIMEOUT_PER_CHAR_MS = 80;
export const TYPE_TIMEOUT_MAX_MS = 120000;

interface EvaluateConfig {
	maxTimeout: number;
	defaultTimeout: number;
}

// Per-tab locks to serialize operations on the same tab
// tabId -> Promise (the currently executing operation)
const tabLocks = new Map<string, Promise<unknown>>();

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = 'operation'): Promise<T> {
	const ms = Math.max(0, Number(timeoutMs) || 0);
	if (ms === 0) return promise;

	let timer: NodeJS.Timeout | null = null;
	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			const err = new Error(`${label} timed out after ${ms}ms`);
			(err as Error & { code?: string }).code = 'ETIMEDOUT';
			reject(err);
		}, ms);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function withTabLock<T>(tabId: string, operation: () => Promise<T>): Promise<T> {
	const pending = tabLocks.get(tabId);
	if (pending) {
		try {
			await pending;
		} catch {
			// Previous operation failed, continue anyway
		}
	}

	const promise = operation();
	tabLocks.set(tabId, promise);

	try {
		return await promise;
	} finally {
		if (tabLocks.get(tabId) === promise) {
			tabLocks.delete(tabId);
		}
	}
}

export function clearTabLock(tabId: string): void {
	tabLocks.delete(tabId);
}

export function clearAllTabLocks(): void {
	tabLocks.clear();
}

export function calculateTypeTimeoutMs(text: string): number {
	const textLength = typeof text === 'string' ? text.length : 0;
	const computedTimeoutMs = TYPE_TIMEOUT_BASE_MS + textLength * TYPE_TIMEOUT_PER_CHAR_MS;
	return Math.min(Math.max(computedTimeoutMs, TYPE_TIMEOUT_BASE_MS), TYPE_TIMEOUT_MAX_MS);
}


export async function safePageClose(
	page:
		| (Pick<Page, 'close'> & { isClosed?: () => boolean })
		| { close: (...args: any[]) => Promise<unknown>; isClosed?: () => boolean }
		| null
		| undefined,
): Promise<void> {
	if (!page) return;
	try {
		if (typeof page.isClosed === 'function' && page.isClosed()) return;
	} catch {
		// ignore
	}

	try {
		await withTimeout((page as any).close({ runBeforeUnload: true }), 5000, 'page.close');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[camofox] page close failed: ${message}`);
	}
}

export function validateUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol as 'http:' | 'https:')) {
			return `Blocked URL scheme: ${parsed.protocol} (only http/https allowed)`;
		}
		return null;
	} catch {
		return `Invalid URL: ${url}`;
	}
}

export function annotateAriaYamlWithRefs(ariaYaml: string | null, refs: Map<string, RefInfo>): string {
	let annotatedYaml = ariaYaml || '';
	if (!annotatedYaml || !refs || refs.size === 0) return annotatedYaml;

	const refsByKey = new Map<string, string>();
	for (const [refId, info] of refs) {
		const role = String(info.role || '').toLowerCase();
		const name = info.name || '';
		const nth = Number.isFinite(info.nth) ? info.nth : 0;
		refsByKey.set(`${role}:${name}:${nth}`, refId);
	}

	const annotationCounts = new Map<string, number>();
	const lines = annotatedYaml.split('\n');
	annotatedYaml = lines
		.map((line) => {
			const match = line.match(/^(\s*-\s+)(\w+)(\s+\"([^\"]*)\")?(.*)$/);
			if (!match) return line;

			const [, prefix, role, nameMatch, name, suffix] = match;
			const normalizedRole = role.toLowerCase();

			if (name && SKIP_PATTERNS.some((p) => p.test(name))) return line;
			if (!INTERACTIVE_ROLES.includes(normalizedRole)) return line;

			const normalizedName = name || '';
			const countKey = `${normalizedRole}:${normalizedName}`;
			const nth = annotationCounts.get(countKey) || 0;
			annotationCounts.set(countKey, nth + 1);

			const refId = refsByKey.get(`${normalizedRole}:${normalizedName}:${nth}`);
			if (!refId) return line;

			return `${prefix}${role}${nameMatch || ''} [${refId}]${suffix}`;
		})
		.join('\n');

	return annotatedYaml;
}

export async function waitForPageReady(page: Page, options: WaitForPageReadyOptions = {}): Promise<boolean> {
	const { timeout = 10000, waitForNetwork = true } = options;

	try {
		await page.waitForLoadState('domcontentloaded', { timeout });

		if (waitForNetwork) {
			await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
				log('warn', 'networkidle timeout, continuing');
			});
		}

		// Framework hydration wait (React/Next.js/Vue) - mirrors Swift WebView.swift logic
		// Wait for readyState === 'complete' + network quiet (40 iterations × 250ms max)
		await page
			.evaluate(async () => {
				type ResourceTimingEntryLike = { responseEnd: number };
				type PerformanceLike = {
					getEntriesByType(type: 'resource'): ResourceTimingEntryLike[];
					now(): number;
				};
				type DocumentLike = { readyState: string };
				type RafLike = (cb: () => void) => number;

				const perf = (globalThis as unknown as { performance: PerformanceLike }).performance;
				const doc = (globalThis as unknown as { document: DocumentLike }).document;
				const raf = (globalThis as unknown as { requestAnimationFrame: RafLike }).requestAnimationFrame;

				for (let i = 0; i < 40; i++) {
					// Check if network is quiet (no recent resource loads)
					const entries = perf.getEntriesByType('resource');
					const recentEntries = entries.slice(-5);
					const netQuiet = recentEntries.every((e) => (perf.now() - e.responseEnd) > 400);

					if (doc.readyState === 'complete' && netQuiet) {
						// Double RAF to ensure paint is complete
						await new Promise<void>((r) => raf(() => raf(() => r())));
						break;
					}
					await new Promise((r) => setTimeout(r, 250));
				}
			})
			.catch(() => {
				log('warn', 'hydration wait failed, continuing');
			});

		await page.waitForTimeout(200);

		await dismissConsentDialogs(page);
		return true;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log('warn', 'page ready failed', { error: message });
		return false;
	}
}

export async function dismissConsentDialogs(page: Page): Promise<void> {
	const dismissSelectors: ReadonlyArray<string> = [
		// OneTrust (very common)
		'#onetrust-banner-sdk button#onetrust-accept-btn-handler',
		'#onetrust-banner-sdk button#onetrust-reject-all-handler',
		'#onetrust-close-btn-container button',
		// Generic patterns
		'button[data-test="cookie-accept-all"]',
		'button[aria-label="Accept all"]',
		'button[aria-label="Accept All"]',
		'button[aria-label="Close"]',
		'button[aria-label="Dismiss"]',
		// Dialog close buttons
		'dialog button:has-text("Close")',
		'dialog button:has-text("Accept")',
		'dialog button:has-text("I Accept")',
		'dialog button:has-text("Got it")',
		'dialog button:has-text("OK")',
		// GDPR/CCPA specific
		'[class*="consent"] button[class*="accept"]',
		'[class*="consent"] button[class*="close"]',
		'[class*="privacy"] button[class*="close"]',
		'[class*="cookie"] button[class*="accept"]',
		'[class*="cookie"] button[class*="close"]',
		// Overlay close buttons
		'[class*="modal"] button[class*="close"]',
		'[class*="overlay"] button[class*="close"]',
	];

	for (const selector of dismissSelectors) {
		try {
			const button = page.locator(selector).first();
			if (await button.isVisible({ timeout: 100 })) {
				await button.click({ timeout: 1000 }).catch(() => {});
				log('info', 'dismissed consent dialog', { selector });
				await page.waitForTimeout(300);
				break;
			}
		} catch {
			// Selector not found or not clickable, continue
		}
	}
}

export async function buildRefs(page: Page, snapshotTimeout?: number): Promise<Map<string, RefInfo>> {
	if (!page || page.isClosed()) {
		log('warn', 'buildRefs: page closed or invalid');
		return new Map<string, RefInfo>();
	}

	const ariaYaml = await getAriaSnapshot(page, snapshotTimeout !== undefined ? { snapshotTimeout } : {});
	if (!ariaYaml) {
		log('warn', 'buildRefs: no aria snapshot');
		return new Map<string, RefInfo>();
	}

	return buildRefsFromAriaSnapshot(ariaYaml);
}

export function buildRefsFromAriaSnapshot(ariaYaml: string | null): Map<string, RefInfo> {
	const refs = new Map<string, RefInfo>();
	if (!ariaYaml) return refs;

	const lines = ariaYaml.split('\n');
	let refCounter = 1;
	const seenCounts = new Map<string, number>();

	for (const line of lines) {
		if (refCounter > MAX_SNAPSHOT_NODES) break;

		const match = line.match(/^\s*-\s+(\w+)(?:\s+\"([^\"]*)\")?/);
		if (match) {
			const [, role, name] = match;
			const normalizedRole = role.toLowerCase();
			if (name && SKIP_PATTERNS.some((p) => p.test(name))) continue;

			if (INTERACTIVE_ROLES.includes(normalizedRole)) {
				const normalizedName = name || '';
				const key = `${normalizedRole}:${normalizedName}`;

				const nth = seenCounts.get(key) || 0;
				seenCounts.set(key, nth + 1);

				const refId = `e${refCounter++}`;
				refs.set(refId, { role: normalizedRole, name: normalizedName, nth });
			}
		}
	}

	return refs;
}

export interface AriaSnapshotOptions {
	/** CSS selector to scope snapshot to a subtree (e.g. dialog, form). Defaults to body. */
	focusSelector?: string;
	/** Hard cap on lines after filtering (heuristic viewport limit). */
	maxLines?: number;
	/** Restrict YAML to nodes whose role matches one of these (parents preserved). */
	rolesFilter?: string[];
	/** Timeout for ariaSnapshot call in ms. Defaults to 10000. Use low values (e.g. 100) for post-click best-effort snapshots. */
	snapshotTimeout?: number;
}

export async function getAriaSnapshot(page: Page, options: AriaSnapshotOptions = {}): Promise<string | null> {
	if (!page || page.isClosed()) return null;
	await waitForPageReady(page, { waitForNetwork: false });
	const target = options.focusSelector ? page.locator(options.focusSelector).first() : page.locator('body');
	const snapTimeout = options.snapshotTimeout ?? 10000;
	let raw: string;
	try {
		raw = await target.ariaSnapshot({ timeout: snapTimeout });
	} catch {
		if (snapTimeout < 1000) return null; // best-effort short timeout, don't retry
		log('warn', 'ariaSnapshot failed, retrying');
		await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
		try {
			raw = await target.ariaSnapshot({ timeout: snapTimeout });
		} catch {
			return null;
		}
	}
	return postProcessAriaYaml(raw, options);
}

function postProcessAriaYaml(yaml: string, options: AriaSnapshotOptions): string {
	let lines = yaml.split('\n');
	if (options.rolesFilter && options.rolesFilter.length > 0) {
		const allowed = new Set(options.rolesFilter.map((r) => r.toLowerCase()));
		const keep = new Array<boolean>(lines.length).fill(false);
		const indents = lines.map((l) => l.match(/^\s*/)?.[0].length ?? 0);
		const roles = lines.map((l) => {
			const m = l.match(/^\s*-\s+(\w+)/);
			return m ? m[1].toLowerCase() : null;
		});
		// First pass: mark direct matches
		for (let i = 0; i < lines.length; i++) {
			if (roles[i] && allowed.has(roles[i] as string)) keep[i] = true;
		}
		// Second pass: keep ancestor chain of any kept line
		for (let i = lines.length - 1; i >= 0; i--) {
			if (!keep[i]) continue;
			let parentIndent = indents[i];
			for (let j = i - 1; j >= 0 && parentIndent > 0; j--) {
				if (indents[j] < parentIndent) {
					keep[j] = true;
					parentIndent = indents[j];
				}
			}
		}
		lines = lines.filter((_, i) => keep[i]);
	}
	if (options.maxLines && lines.length > options.maxLines) {
		lines = lines.slice(0, options.maxLines);
		lines.push(`# ... truncated to ${options.maxLines} lines`);
	}
	return lines.join('\n');
}

/** Locate the topmost open Radix/ARIA dialog and snapshot it. */
export async function getDialogAriaSnapshot(page: Page): Promise<{ snapshot: string; selector: string } | null> {
	if (!page || page.isClosed()) return null;
	const candidates = [
		'[role="dialog"][data-state="open"]',
		'[role="alertdialog"][data-state="open"]',
		'[role="dialog"]:not([aria-hidden="true"])',
		'[role="alertdialog"]:not([aria-hidden="true"])',
	];
	for (const sel of candidates) {
		const loc = page.locator(sel).last();
		if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
			const snap = await getAriaSnapshot(page, { focusSelector: sel });
			if (snap) return { snapshot: snap, selector: sel };
		}
	}
	return null;
}

export function isElementRef(target: string): boolean {
	return isSelectorElementRef(target);
}

function toLocatorRole(role: string): string {
	return role === 'select' ? 'combobox' : role;
}

export async function refToLocator(page: Page, ref: string, refs: Map<string, RefInfo>): Promise<Locator | null> {
	const info = refs.get(ref);
	if (!info) return null;

	const { role, name, nth } = info;
	const locator = page.getByRole(toLocatorRole(role) as never, name ? ({ name } as never) : undefined);
	const count = await locator.count();
	if (count <= nth) {
		const err = new Error(`Ref ${ref} may be stale - snapshot again for fresh refs`);
		(err as Error & { statusCode?: number }).statusCode = 400;
		throw err;
	}
	return locator.nth(nth);
}

function attachConsoleListeners(state: TabState): void {
	const { page } = state;

	page.on('console', (msg) => {
		const location = msg.location();
		const entry: ConsoleEntry = {
			timestamp: Date.now(),
			type: msg.type() as ConsoleEntry['type'],
			text: msg.text(),
			location: location
				? {
					url: location.url,
					lineNumber: location.lineNumber,
					columnNumber: location.columnNumber,
				}
				: undefined,
		};
		state.consoleMessages.push(entry);
		if (state.consoleMessages.length > CONSOLE_BUFFER_SIZE) {
			state.consoleMessages.shift();
		}

		if (msg.type() === 'error') {
			const errorText = msg.text();
			const now = Date.now();
			const lastError = state.pageErrors[state.pageErrors.length - 1];
			if (!lastError || now - lastError.timestamp > 100 || !errorText.includes(lastError.message)) {
				state.pageErrors.push({
					timestamp: now,
					message: errorText,
					stack: undefined,
				});
				if (state.pageErrors.length > CONSOLE_BUFFER_SIZE) {
					state.pageErrors.shift();
				}
			}
		}
	});

	page.on('pageerror', (error) => {
		const now = Date.now();
		const last = state.consoleMessages[state.consoleMessages.length - 1];
		const errorMsg = error?.message || String(error);
		if (last?.type === 'error' && now - last.timestamp < 100 && last.text.includes(errorMsg)) {
			return;
		}

		const entry: PageErrorEntry = {
			timestamp: now,
			message: errorMsg,
			stack: error?.stack,
		};
		state.pageErrors.push(entry);
		if (state.pageErrors.length > CONSOLE_BUFFER_SIZE) {
			state.pageErrors.shift();
		}
	});
}

export function createTabState(page: Page): TabState {
	const state: TabState = {
		page,
		refs: new Map(),
		visitedUrls: new Set(),
		toolCalls: 0,
		consoleMessages: [],
		pageErrors: [],
	};

	attachConsoleListeners(state);
	return state;
}

export async function navigateTab(tabId: string, tabState: TabState, params: { url?: string; macro?: string; query?: string }): Promise<{ ok: true; url: string }>{
	const { url, macro, query } = params;
	let targetUrl = url;
	if (macro) {
		targetUrl = expandMacro(macro, query) || url;
	}
	if (!targetUrl) {
		throw new Error('url or macro required');
	}

	const urlErr = validateUrl(targetUrl);
	if (urlErr) {
		const err = new Error(urlErr);
		// Used by routes to map to 400.
		(err as Error & { statusCode?: number }).statusCode = 400;
		throw err;
	}

	return withTabLock(tabId, async () => {
		await tabState.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
		tabState.visitedUrls.add(targetUrl);
		tabState.refs = await buildRefs(tabState.page);
		return { ok: true as const, url: tabState.page.url() };
	});
}

export interface SnapshotTabOptions extends AriaSnapshotOptions {
	currentTask?: string;
	lastAction?: string;
	/** Mark lines that did not exist in the previous snapshot with `*`. Default: true. */
	diff?: boolean;
}

function applyDiffMarkers(
	annotatedYaml: string,
	previous: string | null | undefined,
): { yaml: string; newCount: number } {
	if (!previous) return { yaml: annotatedYaml, newCount: 0 };
	const prevSet = new Set(previous.split('\n').map((l) => l.trim()).filter(Boolean));
	let newCount = 0;
	const lines = annotatedYaml.split('\n').map((line) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) return line;
		if (!trimmed.startsWith('-')) return line;
		if (prevSet.has(trimmed)) return line;
		newCount++;
		const indentMatch = line.match(/^(\s*)/);
		const indent = indentMatch ? indentMatch[1] : '';
		return `${indent}* ${line.trimStart()}`;
	});
	return { yaml: lines.join('\n'), newCount };
}

export async function snapshotTab(
	tabState: TabState,
	options: SnapshotTabOptions = {},
): Promise<{ url: string; snapshot: string; refsCount: number; scoped?: boolean; newElementsCount?: number }> {
	const { currentTask, lastAction, diff = true, ...ariaOpts } = options;
	const ariaYaml = await getAriaSnapshot(tabState.page, ariaOpts);
	tabState.refs = buildRefsFromAriaSnapshot(ariaYaml);
	let annotatedYaml = annotateAriaYamlWithRefs(ariaYaml, tabState.refs);

	let newElementsCount = 0;
	if (diff && !ariaOpts.focusSelector && !ariaOpts.rolesFilter?.length) {
		// Only diff full-body snapshots to avoid spurious markers on scoped views.
		const result = applyDiffMarkers(annotatedYaml, tabState.lastSnapshot);
		annotatedYaml = result.yaml;
		newElementsCount = result.newCount;
		// Save un-marked baseline for next diff.
		tabState.lastSnapshot = annotateAriaYamlWithRefs(ariaYaml, tabState.refs);
	}

	if (currentTask || lastAction) {
		const banner: string[] = [];
		if (currentTask) banner.push(`# task: ${currentTask.replace(/\n/g, ' ').slice(0, 200)}`);
		if (lastAction) banner.push(`# last_action: ${lastAction.replace(/\n/g, ' ').slice(0, 200)}`);
		if (newElementsCount > 0) banner.push(`# new_elements: ${newElementsCount} (marked with *)`);
		annotatedYaml = `${banner.join('\n')}\n${annotatedYaml}`;
	} else if (newElementsCount > 0) {
		annotatedYaml = `# new_elements: ${newElementsCount} (marked with *)\n${annotatedYaml}`;
	}

	return {
		url: tabState.page.url(),
		snapshot: annotatedYaml,
		refsCount: tabState.refs.size,
		scoped: Boolean(ariaOpts.focusSelector || ariaOpts.rolesFilter?.length || ariaOpts.maxLines),
		newElementsCount: newElementsCount > 0 ? newElementsCount : undefined,
	};
}

export async function snapshotTabDialog(
	tabState: TabState,
): Promise<{ url: string; snapshot: string; refsCount: number; selector: string } | null> {
	const found = await getDialogAriaSnapshot(tabState.page);
	if (!found) return null;
	tabState.refs = buildRefsFromAriaSnapshot(found.snapshot);
	const annotatedYaml = annotateAriaYamlWithRefs(found.snapshot, tabState.refs);
	return {
		url: tabState.page.url(),
		snapshot: annotatedYaml,
		refsCount: tabState.refs.size,
		selector: found.selector,
	};
}

export type ClickStrategy = 'locator' | 'force' | 'mouse' | 'jsdispatch' | 'keyboard-space';

export interface ClickOptions {
	ref?: string;
	selector?: string;
	/** Per-strategy Playwright timeout in ms. Range 1000-30000, default 5000. */
	timeout?: number;
	/** Skip plain locator click and start at force/mouse fallback chain. */
	force?: boolean;
	/** After click, verify a state change (aria-checked, data-state, input value, URL). */
	verify?: boolean;
}

export interface ClickResult {
	ok: true;
	url: string;
	strategy: ClickStrategy;
	attempts: number;
	verifiedStateChange?: boolean;
	/** Pre/post snapshots used for verification (debugging aid). */
	verifyDetails?: { before?: Record<string, string | null>; after?: Record<string, string | null> };
}

const DEFAULT_CLICK_TIMEOUT_MS = 20000;
const MIN_CLICK_TIMEOUT_MS = 1000;
const MAX_CLICK_TIMEOUT_MS = 30000;
const RETRY_BACKOFF_MS = [0, 300, 1000] as const;

export async function clickTab(tabId: string, tabState: TabState, params: ClickOptions): Promise<ClickResult> {
	const { ref, selector, force = false, verify = false } = params;
	if (!ref && !selector) {
		const err = new Error('ref or selector required');
		(err as Error & { statusCode?: number }).statusCode = 400;
		throw err;
	}

	const timeout = Math.min(
		MAX_CLICK_TIMEOUT_MS,
		Math.max(MIN_CLICK_TIMEOUT_MS, params.timeout ?? DEFAULT_CLICK_TIMEOUT_MS),
	);

	return withTabLock(tabId, async () => {
		const page = tabState.page;

		// Capture verify state (best-effort; failures are non-fatal for click itself)
		const captureVerifyState = async (locator: Locator): Promise<Record<string, string | null>> => {
			try {
				return await locator.evaluate((el) => {
					const e = el as { getAttribute?: (k: string) => string | null; value?: string; checked?: boolean };
					return {
						ariaChecked: e.getAttribute?.('aria-checked') ?? null,
						ariaPressed: e.getAttribute?.('aria-pressed') ?? null,
						ariaExpanded: e.getAttribute?.('aria-expanded') ?? null,
						dataState: e.getAttribute?.('data-state') ?? null,
						value: typeof e.value === 'string' ? e.value : null,
						checked: typeof e.checked === 'boolean' ? String(e.checked) : null,
					};
				});
			} catch {
				return {};
			}
		};

		const dispatchMouseSequence = async (locator: Locator): Promise<void> => {
			const box = await locator.boundingBox();
			if (!box) throw new Error('Element not visible (no bounding box)');
			const x = box.x + box.width / 2;
			const y = box.y + box.height / 2;
			await page.mouse.move(x, y);
			await page.waitForTimeout(50);
			await page.mouse.down();
			await page.waitForTimeout(50);
			await page.mouse.up();
			log('info', 'mouse sequence dispatched', { x: x.toFixed(0), y: y.toFixed(0) });
		};

		// JS dispatchEvent fallback (the manual workaround that consistently worked
		// against Radix UI dialog buttons / autocomplete options where Playwright's
		// locator.click times out despite the element being visible/enabled).
		const dispatchJsClick = async (locator: Locator): Promise<void> => {
			await locator.evaluate((el) => {
				const browserGlobal = globalThis as { MouseEvent?: { new(type: string, init?: { bubbles?: boolean; cancelable?: boolean }): unknown } };
				const MouseEventCtor = browserGlobal.MouseEvent;
				if (typeof MouseEventCtor !== 'function') return;
				const target = el as { dispatchEvent: (ev: unknown) => boolean };
				const opts = { bubbles: true, cancelable: true };
				target.dispatchEvent(new MouseEventCtor('mousedown', opts));
				target.dispatchEvent(new MouseEventCtor('mouseup', opts));
				target.dispatchEvent(new MouseEventCtor('click', opts));
			});
		};

		// Radix UI custom checkboxes: button[role=checkbox] with data-state="checked|unchecked".
		// Playwright's click occasionally fails to flip aria-checked. Pressing Space on
		// the focused element reliably toggles the controlled state.
		const keyboardSpace = async (locator: Locator): Promise<void> => {
			await locator.focus();
			await page.keyboard.press('Space');
		};

		const tryStrategy = async (locator: Locator, strategy: ClickStrategy): Promise<void> => {
			switch (strategy) {
				case 'locator':
					await locator.click({ timeout });
					return;
				case 'force':
					await locator.click({ timeout, force: true });
					return;
				case 'mouse':
					await dispatchMouseSequence(locator);
					return;
				case 'jsdispatch':
					await dispatchJsClick(locator);
					return;
				case 'keyboard-space':
					await keyboardSpace(locator);
					return;
			}
		};

		const buildLocator = (): Locator | Promise<Locator | null> => {
			if (ref) return refToLocator(page, ref, tabState.refs);
			return Promise.resolve(page.locator(selector as string));
		};

		const initialLocator = await buildLocator();
		if (!initialLocator) {
			const maxRef = tabState.refs.size > 0 ? `e${tabState.refs.size}` : 'none';
			const err = new Error(
				`Unknown ref: ${ref} (valid refs: e1-${maxRef}, ${tabState.refs.size} total). Refs reset after navigation - call snapshot first.`,
			);
			(err as Error & { statusCode?: number }).statusCode = 400;
			throw err;
		}

		// Build the strategy ladder. If `force=true` we skip the plain locator click.
		const strategyOrder: ClickStrategy[] = force
			? ['force', 'mouse', 'jsdispatch']
			: ['locator', 'force', 'mouse', 'jsdispatch'];

		// Auto-detect Radix-style controlled checkbox / switch and add keyboard-space last.
		try {
			const isControlledToggle = await initialLocator.evaluate((el) => {
				const e = el as { getAttribute?: (k: string) => string | null };
				const role = e.getAttribute?.('role');
				const dataState = e.getAttribute?.('data-state');
				return (role === 'checkbox' || role === 'switch') && (dataState === 'checked' || dataState === 'unchecked');
			}).catch(() => false);
			if (isControlledToggle) strategyOrder.push('keyboard-space');
		} catch {
			/* non-fatal */
		}

		const before = verify ? await captureVerifyState(initialLocator) : undefined;
		const beforeUrl = page.url();

		let lastErr: unknown;
		let chosenStrategy: ClickStrategy = strategyOrder[0];
		let attempts = 0;
		// Strategies that proved useless this click (e.g. force after locator already timed out).
		const skippedStrategies = new Set<ClickStrategy>();

		outer: for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length; attempt++) {
			if (RETRY_BACKOFF_MS[attempt] > 0) {
				// If the URL already changed while we were waiting to retry, the click
				// already had its intended effect — don't fire a second time.
				if (page.url() !== beforeUrl) {
					chosenStrategy = strategyOrder[0];
					lastErr = undefined;
					log('info', 'click: URL changed before retry, treating as success');
					break outer;
				}
				await page.waitForTimeout(RETRY_BACKOFF_MS[attempt]);
				// Check again after the wait.
				if (page.url() !== beforeUrl) {
					chosenStrategy = strategyOrder[0];
					lastErr = undefined;
					log('info', 'click: URL changed during backoff, treating as success');
					break outer;
				}
			}
			// On retries, refresh the locator (refs may be stale after partial DOM updates).
			const locator = attempt === 0 ? initialLocator : (await buildLocator()) ?? initialLocator;

			for (const strategy of strategyOrder) {
				if (skippedStrategies.has(strategy)) continue;
				attempts++;
				try {
					await tryStrategy(locator, strategy);
					chosenStrategy = strategy;
					lastErr = undefined;
					break outer;
				} catch (err) {
					lastErr = err;
					const message = err instanceof Error ? err.message : String(err);
					log('warn', 'click strategy failed', { strategy, attempt, message: message.slice(0, 200) });
					// Hard errors that no fallback can fix → abort.
					if (/closed|navigation|context destroyed|browser has been closed/i.test(message)) {
						throw err;
					}
					// locator timed out → force uses the same Playwright locator path and will
					// also time out. Skip it to go straight to mouse.
					if (strategy === 'locator' && /timeout/i.test(message)) {
						skippedStrategies.add('force');
					}
				}
			}
		}

		if (lastErr) {
			throw lastErr;
		}

		await page.waitForTimeout(1000);
		// Best-effort 100ms snapshot; if the DOM hasn't settled yet (< 5 refs), wait
		// another 500ms and do a proper 2s snapshot.
		let postClickRefs = await buildRefs(page, 100);
		if (postClickRefs.size < 5) {
			await page.waitForTimeout(500);
			postClickRefs = await buildRefs(page, 2000);
		}
		tabState.refs = postClickRefs;

		let verifiedStateChange: boolean | undefined;
		let verifyDetails: ClickResult['verifyDetails'];
		if (verify && before) {
			const newLocator = (await buildLocator()) ?? null;
			const after = newLocator ? await captureVerifyState(newLocator) : {};
			verifyDetails = { before, after };
			const urlChanged = page.url() !== beforeUrl;
			const stateChanged = Object.keys(before).some((k) => before[k] !== after[k]);
			verifiedStateChange = urlChanged || stateChanged;
		}

		const newUrl = page.url();
		tabState.visitedUrls.add(newUrl);
		return {
			ok: true as const,
			url: newUrl,
			strategy: chosenStrategy,
			attempts,
			...(verifiedStateChange !== undefined ? { verifiedStateChange } : {}),
			...(verifyDetails ? { verifyDetails } : {}),
		};
	});
}

/**
 * Smart fill that handles contenteditable elements differently from standard inputs.
 * Prevents text doubling on rich-text editors (Lexical, ProseMirror, Slate, etc.)
 */
export async function smartFill(locator: Locator, page: Page, text: string): Promise<void> {
	const elementMetadata = await locator
		.evaluate((el) => ({
			isContentEditable: Boolean((el as any).isContentEditable),
			tagName: typeof (el as { tagName?: string }).tagName === 'string' ? (el as { tagName: string }).tagName : '',
		}))
		.catch(() => ({ isContentEditable: false, tagName: '' }));
	const { isContentEditable, tagName } = elementMetadata;
	const shouldUseBulkInsert = text.length >= LONG_TEXT_THRESHOLD;

	if (shouldUseBulkInsert) {
		// Long text would exceed the humanized per-character route budget, so set it in one DOM operation.
		await locator.evaluate((element, value) => {
			const browserGlobal = globalThis as any;
			const browserDocument = browserGlobal.document as any;
			const eventCtor = browserGlobal.Event as { new(type: string, init?: { bubbles?: boolean }): Event } | undefined;
			const target = element as any;
			const dispatch = (eventName: string) => {
				if (typeof eventCtor === 'function') {
					target.dispatchEvent(new eventCtor(eventName, { bubbles: true }));
				}
			};

			if (typeof target.focus === 'function') {
				target.focus();
			}
			dispatch('focus');

			if (target.isContentEditable) {
				const selection = browserDocument?.defaultView?.getSelection?.() ?? browserGlobal.getSelection?.();
				if (selection && browserDocument?.createRange) {
					const range = browserDocument.createRange();
					range.selectNodeContents(target);
					selection.removeAllRanges();
					selection.addRange(range);
				}

				const inserted = typeof browserDocument?.execCommand === 'function'
					? browserDocument.execCommand('insertText', false, value)
					: false;
				if (!inserted) {
					target.textContent = value;
				}
			} else if (target instanceof browserGlobal.HTMLInputElement || target instanceof browserGlobal.HTMLTextAreaElement) {
				const prototype = target instanceof browserGlobal.HTMLTextAreaElement
					? browserGlobal.HTMLTextAreaElement.prototype
					: browserGlobal.HTMLInputElement.prototype;
				const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
				if (typeof nativeSetter === 'function') {
					nativeSetter.call(target, value);
				} else {
					target.value = value;
				}
			} else {
				target.textContent = value;
			}

			dispatch('input');
			dispatch('change');
		}, text);
		return;
	}

	if (isContentEditable) {
		await locator.focus();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.insertText(text);
	} else if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
		await locator.fill(text, { timeout: 10000 });
	} else {
		await locator.fill(text, { timeout: 10000 });
	}
}

export async function typeTab(tabId: string, tabState: TabState, params: { ref?: string; selector?: string; text: string }): Promise<{ ok: true }>{
	const { ref, selector, text } = params;
	if (!ref && !selector) {
		const err = new Error('ref or selector required');
		(err as Error & { statusCode?: number }).statusCode = 400;
		throw err;
	}

	await withTabLock(tabId, async () => {
		let locator: Locator;
		if (ref) {
			const resolved = await refToLocator(tabState.page, ref, tabState.refs);
			if (!resolved) {
				const err = new Error(`Unknown ref: ${ref}. Call snapshot first.`);
				(err as any).statusCode = 400;
				throw err;
			}
			locator = resolved;
		} else {
			locator = tabState.page.locator(selector as string);
		}

		await smartFill(locator, tabState.page, text);
	});

	return { ok: true as const };
}

export async function pressTab(tabId: string, tabState: TabState, key: string): Promise<{ ok: true }>{
	await withTabLock(tabId, async () => {
		await tabState.page.keyboard.press(key);
	});
	return { ok: true as const };
}

export async function scrollTab(tabState: TabState, params: { direction?: 'up' | 'down'; amount?: number }): Promise<{ ok: true }>{
	const { direction = 'down', amount = 500 } = params;
	const delta = direction === 'up' ? -amount : amount;
	await tabState.page.mouse.wheel(0, delta);
	await tabState.page.waitForTimeout(300);
	return { ok: true as const };
}

export async function scrollElementTab(
	tabId: string,
	tabState: TabState,
	params: { selector?: string; ref?: string; deltaX?: number; deltaY?: number; scrollTo?: { top?: number; left?: number } },
): Promise<{ ok: true; scrollPosition: ScrollPosition }>{
	const { selector, ref, scrollTo } = params;
	if (!ref && !selector) {
		const err = new Error('ref or selector required');
		(err as Error & { statusCode?: number }).statusCode = 400;
		throw err;
	}

	return withTabLock(tabId, async () => {
		const page = tabState.page;

		let locator: Locator;
		if (ref) {
			const resolved = await refToLocator(page, ref, tabState.refs);
			if (!resolved) {
				const maxRef = tabState.refs.size > 0 ? `e${tabState.refs.size}` : 'none';
				const err = new Error(
					`Unknown ref: ${ref} (valid refs: e1-${maxRef}, ${tabState.refs.size} total). Refs reset after navigation - call snapshot first.`,
				);
				(err as Error & { statusCode?: number }).statusCode = 400;
				throw err;
			}
			locator = resolved;
		} else {
			locator = page.locator(selector as string);
			const count = await locator.count();
			if (count === 0) {
				const err = new Error(`Element not found: ${selector}`);
				(err as Error & { statusCode?: number }).statusCode = 400;
				throw err;
			}
		}

		const element = locator.first();

		if (scrollTo) {
			await element.evaluate(
				(el, pos) => {
					const e = el as unknown as { scrollTop: number; scrollLeft: number };
					const p = pos as { top?: number; left?: number };
					if (p.top !== undefined) e.scrollTop = p.top;
					if (p.left !== undefined) e.scrollLeft = p.left;
				},
				scrollTo,
			);
		} else {
			const deltaX = params.deltaX ?? 0;
			const deltaY = params.deltaY ?? 300;
			await element.evaluate(
				(el, delta) => {
					(el as unknown as { scrollBy: (opts: { top: number; left: number; behavior: 'auto' }) => void }).scrollBy({
						top: (delta as { y: number }).y,
						left: (delta as { x: number }).x,
						behavior: 'auto',
					});
				},
				{ x: deltaX, y: deltaY },
			);
		}

		await page.waitForTimeout(200);

		const scrollPosition = (await element.evaluate((el) => {
			const e = el as unknown as {
				scrollTop: number;
				scrollLeft: number;
				scrollHeight: number;
				clientHeight: number;
				scrollWidth: number;
				clientWidth: number;
			};
			return {
				scrollTop: e.scrollTop,
				scrollLeft: e.scrollLeft,
				scrollHeight: e.scrollHeight,
				clientHeight: e.clientHeight,
				scrollWidth: e.scrollWidth,
				clientWidth: e.clientWidth,
			};
		})) as ScrollPosition;

		return { ok: true as const, scrollPosition };
	});
}

export async function evaluateTab(
	tabId: string,
	tabState: TabState,
	params: { expression: string; timeout?: number },
): Promise<EvaluateResult> {
	return _evaluateInternal(tabId, tabState, params, {
		maxTimeout: MAX_EVAL_TIMEOUT,
		defaultTimeout: DEFAULT_EVAL_TIMEOUT,
	});
}

async function _evaluateInternal(
	tabId: string,
	tabState: TabState,
	params: { expression: string; timeout?: number },
	config: EvaluateConfig,
): Promise<EvaluateResult> {
	return withTabLock(tabId, async () => {
		const page = tabState.page;
		const timeout = Math.min(Math.max(params.timeout ?? config.defaultTimeout, 100), config.maxTimeout);

		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeoutId = setTimeout(() => reject(new Error('EVAL_TIMEOUT')), timeout);
		});

		try {
			const result = await Promise.race([page.evaluate(params.expression), timeoutPromise]);

			const serialized = JSON.stringify(result);
			if (serialized === undefined) {
				return {
					ok: true,
					result,
					resultType: typeof result,
					truncated: false,
				};
			}

			const truncated = serialized.length > MAX_RESULT_SIZE;
			if (truncated) {
				return {
					ok: true,
					result: `[Truncated: result was ${serialized.length} bytes, max ${MAX_RESULT_SIZE}]`,
					resultType: 'string',
					truncated: true,
				};
			}

			return {
				ok: true,
				result,
				resultType: result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result,
				truncated: false,
			};
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			if (message === 'EVAL_TIMEOUT') {
				return {
					ok: false,
					error: `Evaluation timed out after ${timeout}ms`,
					errorType: 'timeout',
				};
			}
			return {
				ok: false,
				error: message,
				errorType: 'js_error',
			};
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}
	});
}

export async function evaluateTabExtended(
	tabId: string,
	tabState: TabState,
	params: { expression: string; timeout?: number },
): Promise<EvaluateResult> {
	return _evaluateInternal(tabId, tabState, params, {
		maxTimeout: MAX_EVAL_EXTENDED_TIMEOUT,
		defaultTimeout: DEFAULT_EVAL_EXTENDED_TIMEOUT,
	});
}

export async function backTab(tabId: string, tabState: TabState): Promise<{ ok: true; url: string }>{
	return withTabLock(tabId, async () => {
		await tabState.page.goBack({ timeout: 10000 });
		tabState.refs = await buildRefs(tabState.page);
		return { ok: true as const, url: tabState.page.url() };
	});
}

export async function forwardTab(tabId: string, tabState: TabState): Promise<{ ok: true; url: string }>{
	return withTabLock(tabId, async () => {
		await tabState.page.goForward({ timeout: 10000 });
		tabState.refs = await buildRefs(tabState.page);
		return { ok: true as const, url: tabState.page.url() };
	});
}

export async function refreshTab(tabId: string, tabState: TabState): Promise<{ ok: true; url: string }>{
	return withTabLock(tabId, async () => {
		await tabState.page.reload({ timeout: 30000 });
		tabState.refs = await buildRefs(tabState.page);
		return { ok: true as const, url: tabState.page.url() };
	});
}

export async function getLinks(
	tabState: TabState,
	params: { limit: number; offset: number; scope?: string; extension?: string; downloadOnly?: boolean },
): Promise<{ links: Array<{ url: string; text: string }>; pagination: { total: number; offset: number; limit: number; hasMore: boolean } }>{
	const { limit, offset, scope, extension, downloadOnly } = params;
	const extFilters = String(extension || '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
		.map((e) => (e.startsWith('.') ? e : `.${e}`));

	const allLinks = await tabState.page.evaluate(
		({ scopeSel, dlOnly, exts }) => {
			type AnchorLike = { href?: string; textContent?: string | null; hasAttribute?(name: string): boolean };
			type QueryRootLike = {
				querySelector?(selector: string): QueryRootLike | null;
				querySelectorAll(selector: string): { forEach(cb: (a: AnchorLike) => void): void };
			};
			type DocumentLike = QueryRootLike;
			const doc = (globalThis as unknown as { document: DocumentLike }).document;

			const root: QueryRootLike | null = scopeSel ? (doc.querySelector ? doc.querySelector(scopeSel) : null) : doc;
			if (!root) return [] as Array<{ url: string; text: string }>;

			const extOk = (href: string): boolean => {
				if (!exts || exts.length === 0) return true;
				try {
					const u = new URL(href);
					const p = (u.pathname || '').toLowerCase();
					return (exts as string[]).some((e) => p.endsWith(e));
				} catch {
					return false;
				}
			};

			const links: Array<{ url: string; text: string }> = [];
			root.querySelectorAll('a[href]').forEach((a) => {
				if (dlOnly && !(typeof a.hasAttribute === 'function' && a.hasAttribute('download'))) return;
				const href = typeof a.href === 'string' ? a.href : '';
				const text = (a.textContent ?? '').trim().slice(0, 100);
				if (href && href.startsWith('http') && extOk(href)) {
					links.push({ url: href, text });
				}
			});
			return links;
		},
		{ scopeSel: scope || null, dlOnly: !!downloadOnly, exts: extFilters },
	);

	const total = allLinks.length;
	const paginated = allLinks.slice(offset, offset + limit);
	return {
		links: paginated,
		pagination: { total, offset, limit, hasMore: offset + limit < total },
	};
}

export interface ScreenshotOptions {
	fullPage?: boolean;
	/** Restrict capture to a region; reduces vision token cost. */
	clip?: { x: number; y: number; width: number; height: number };
	/** 'png' (default) or 'jpeg'. JPEG enables `quality` and shrinks payload. */
	type?: 'png' | 'jpeg';
	/** JPEG quality 1-100 (only when type='jpeg'). */
	quality?: number;
}

export async function screenshotTab(tabState: TabState, options: ScreenshotOptions | boolean = {}): Promise<{ buffer: Buffer; mime: 'image/png' | 'image/jpeg' }> {
	// Backward-compatible: caller passing a boolean = legacy fullPage flag.
	const opts: ScreenshotOptions = typeof options === 'boolean' ? { fullPage: options } : options;
	const type = opts.type ?? 'png';
	const playwrightOpts: { type: 'png' | 'jpeg'; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number }; quality?: number } = {
		type,
		fullPage: opts.fullPage,
	};
	if (opts.clip) playwrightOpts.clip = opts.clip;
	if (type === 'jpeg' && typeof opts.quality === 'number') {
		playwrightOpts.quality = Math.max(1, Math.min(100, Math.round(opts.quality)));
	}
	const buffer = await tabState.page.screenshot(playwrightOpts);
	return { buffer: buffer as Buffer, mime: type === 'jpeg' ? 'image/jpeg' : 'image/png' };
}

export async function waitTab(tabState: TabState, params: { timeout: number; waitForNetwork: boolean }): Promise<{ ok: true; ready: boolean }>{
	const ready = await waitForPageReady(tabState.page, { timeout: params.timeout, waitForNetwork: params.waitForNetwork });
	return { ok: true as const, ready };
}
