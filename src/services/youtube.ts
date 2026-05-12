import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const YT_DLP_CANDIDATES = ['yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'] as const;

function formatMs(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}]`;
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/gi, "'")
		.replace(/&#x2F;/gi, '/');
}

function normalizeTranscriptText(raw: string): string {
	return decodeHtmlEntities(raw)
		.replace(/\s+/g, ' ')
		.trim();
}

export function extractVideoId(url: string): string | null {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (host === 'youtu.be') {
			const id = parsed.pathname.split('/').filter(Boolean)[0];
			return id || null;
		}
		if (parsed.pathname.startsWith('/shorts/')) {
			const id = parsed.pathname.split('/').filter(Boolean)[1];
			return id || null;
		}
		return parsed.searchParams.get('v') || null;
	} catch {
		return null;
	}
}

function buildSafeEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of SAFE_ENV_KEYS) {
		const value = process.env[key];
		if (typeof value === 'string' && value.length > 0) env[key] = value;
	}
	return env;
}

async function runYtDlp(binary: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
	const result = await execFileAsync(binary, args, {
		env: buildSafeEnv(),
		timeout: Math.max(1000, timeoutMs),
		maxBuffer: 4 * 1024 * 1024,
		windowsHide: true,
	});
	return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export async function detectYtDlp(log: (...args: unknown[]) => void): Promise<void> {
	for (const candidate of YT_DLP_CANDIDATES) {
		try {
			const { stdout } = await runYtDlp(candidate, ['--version'], 5000);
			log(`yt-dlp detected at ${candidate} (version: ${stdout.trim() || 'unknown'})`);
			return;
		} catch {
			continue;
		}
	}
	log('yt-dlp not detected; browser fallback will be used for YouTube transcripts');
}

export function parseJson3(content: string): string | null {
	try {
		const parsed = JSON.parse(content) as {
			events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }>;
		};
		const events = Array.isArray(parsed.events) ? parsed.events : [];
		const lines: string[] = [];

		for (const event of events) {
			if (!Array.isArray(event.segs) || event.segs.length === 0) continue;
			const text = normalizeTranscriptText(event.segs.map((segment) => segment.utf8 || '').join(''));
			if (!text) continue;
			const ts = formatMs(Number(event.tStartMs || 0));
			lines.push(`${ts} ${text}`);
		}

		return lines.length ? `${lines.join('\n')}\n` : null;
	} catch {
		return null;
	}
}

export function formatVttTs(ts: string): string {
	const raw = ts.trim();
	const parts = raw.split(':');
	let minutes = 0;
	let seconds = 0;

	if (parts.length === 3) {
		minutes = Number(parts[0]) * 60 + Number(parts[1]);
		seconds = Number(parts[2].split('.')[0]);
	} else if (parts.length === 2) {
		minutes = Number(parts[0]);
		seconds = Number(parts[1].split('.')[0]);
	}

	if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return '[00:00]';
	return `[${String(Math.max(0, minutes)).padStart(2, '0')}:${String(Math.max(0, seconds)).padStart(2, '0')}]`;
}

export function parseVtt(content: string): string {
	const lines = content.split(/\r?\n/);
	const output: string[] = [];
	let currentTs = '[00:00]';
	let cueText: string[] = [];

	const flush = (): void => {
		if (!cueText.length) return;
		const text = normalizeTranscriptText(cueText.join(' '));
		if (text) output.push(`${currentTs} ${text}`);
		cueText = [];
	};

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			flush();
			continue;
		}
		if (trimmed === 'WEBVTT' || trimmed.startsWith('NOTE') || /^\d+$/.test(trimmed)) {
			continue;
		}
		if (trimmed.includes('-->')) {
			flush();
			currentTs = formatVttTs(trimmed.split('-->')[0]);
			continue;
		}
		if (/^(Kind|Language):/i.test(trimmed)) continue;
		cueText.push(trimmed.replace(/<[^>]+>/g, ''));
	}
	flush();

	return output.length ? `${output.join('\n')}\n` : '';
}

export function parseXml(content: string): string {
	const output: string[] = [];
	const regex = /<text[^>]*start="([0-9.]+)"[^>]*>([\s\S]*?)<\/text>/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		const seconds = Number(match[1]);
		const text = normalizeTranscriptText(match[2].replace(/<[^>]+>/g, ''));
		if (!Number.isFinite(seconds) || !text) continue;
		output.push(`${formatMs(seconds * 1000)} ${text}`);
	}

	return output.length ? `${output.join('\n')}\n` : '';
}
