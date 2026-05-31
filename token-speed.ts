/**
 * Sliding-window token speed tracker.
 * Dependency-free and testable without Pi internals.
 */

const DEFAULT_WINDOW_MS = 1000;
const DEFAULT_COMPACTION_THRESHOLD = 5000;

export interface TokenSpeedSnapshot {
	isStreaming: boolean;
	tokenCount: number;
	elapsedMs: number;
	/** Sliding-window TPS while streaming after the window fills; cumulative average otherwise. */
	tps: number;
	/** Always the cumulative total tokens / total elapsed seconds average. */
	averageTps: number;
}

export interface TokenSpeedTrackerOptions {
	/** Sliding window duration in milliseconds. Defaults to 1000. */
	windowMs?: number;
	/** Compact the timestamp array when the discarded prefix reaches this size. Defaults to 5000. */
	compactionThreshold?: number;
}

export class TokenSpeedTracker {
	private isActive = false;
	private count = 0;
	private startedAt: number | null = null;
	private endedAt: number | null = null;
	private timestamps: number[] = [];
	private windowStartIndex = 0;
	private readonly windowMs: number;
	private readonly compactionThreshold: number;

	constructor(options: TokenSpeedTrackerOptions = {}) {
		this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
		this.compactionThreshold = options.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
	}

	get isStreaming(): boolean {
		return this.isActive;
	}

	get tokenCount(): number {
		return this.count;
	}

	start(now = Date.now()): void {
		this.isActive = true;
		this.count = 0;
		this.startedAt = now;
		this.endedAt = now;
		this.timestamps = [];
		this.windowStartIndex = 0;
	}

	recordToken(now = Date.now()): void {
		if (!this.isActive) return;

		this.count += 1;
		this.timestamps.push(now);

		if (this.windowStartIndex >= this.compactionThreshold) {
			this.compact();
		}
	}

	stop(now = Date.now()): TokenSpeedSnapshot {
		if (this.isActive) {
			this.endedAt = now;
		}
		this.isActive = false;
		this.timestamps = [];
		this.windowStartIndex = 0;
		return this.snapshot(now);
	}

	snapshot(now = Date.now()): TokenSpeedSnapshot {
		if (this.startedAt === null) {
			return {
				isStreaming: false,
				tokenCount: 0,
				elapsedMs: 0,
				tps: 0,
				averageTps: 0,
			};
		}

		const end = this.isActive ? now : this.endedAt ?? now;
		const elapsedMs = Math.max(end - this.startedAt, 0);
		const averageTps = elapsedMs > 0 ? this.count / (elapsedMs / 1000) : 0;

		if (!this.isActive || elapsedMs < this.windowMs) {
			return {
				isStreaming: this.isActive,
				tokenCount: this.count,
				elapsedMs,
				tps: averageTps,
				averageTps,
			};
		}

		const windowStart = now - this.windowMs;
		while (
			this.windowStartIndex < this.timestamps.length &&
			this.timestamps[this.windowStartIndex] < windowStart
		) {
			this.windowStartIndex += 1;
		}

		const windowTokenCount = this.timestamps.length - this.windowStartIndex;
		if (windowTokenCount === 0) {
			return {
				isStreaming: true,
				tokenCount: this.count,
				elapsedMs,
				tps: averageTps,
				averageTps,
			};
		}

		return {
			isStreaming: true,
			tokenCount: this.count,
			elapsedMs,
			tps: windowTokenCount / (this.windowMs / 1000),
			averageTps,
		};
	}

	private compact(): void {
		if (this.windowStartIndex === 0) return;
		this.timestamps = this.timestamps.slice(this.windowStartIndex);
		this.windowStartIndex = 0;
	}
}
