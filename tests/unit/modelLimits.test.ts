import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	getModelLimits,
	isOverThreshold,
	calculateUsagePercentage,
	DEFAULT_THRESHOLD,
} from '../../src/agent/context/modelLimits.ts';

describe('getModelLimits', () => {
	it('returns limits for deepseek-v4-pro', () => {
		const limits = getModelLimits('deepseek-v4-pro');
		assert.equal(limits.inputLimit, 128000);
		assert.equal(limits.outputLimit, 32000);
		assert.equal(limits.contextWindow, 262144);
	});

	it('returns limits for deepseek-v4-flash', () => {
		const limits = getModelLimits('deepseek-v4-flash');
		assert.equal(limits.contextWindow, 131072);
	});

	it('matches gpt-5 variants', () => {
		const limits = getModelLimits('gpt-5-mini');
		assert.equal(limits.contextWindow, 400000);
	});

	it('matches gpt-5 base', () => {
		const limits = getModelLimits('gpt-5');
		assert.equal(limits.contextWindow, 400000);
	});

	it('matches local model patterns (case insensitive)', () => {
		const llama = getModelLimits('meta-llama/Llama-4-Maverick');
		assert.equal(llama.contextWindow, 131072);

		const gemma = getModelLimits('google/Gemma-4-31b');
		assert.equal(gemma.contextWindow, 131072);

		const phi = getModelLimits('microsoft/Phi-4-mini');
		assert.equal(phi.contextWindow, 131072);
	});

	it('falls back to defaults for unknown models', () => {
		const limits = getModelLimits('completely-unknown-model');
		assert.equal(limits.inputLimit, 128000);
		assert.equal(limits.outputLimit, 16000);
		assert.equal(limits.contextWindow, 128000);
	});
});

describe('isOverThreshold', () => {
	it('returns true when usage exceeds threshold', () => {
		// 90_000 > 100_000 * 0.8 = 80_000
		assert.equal(isOverThreshold(90_000, 100_000), true);
	});

	it('returns false when usage is below threshold', () => {
		assert.equal(isOverThreshold(50_000, 100_000), false);
	});

	it('returns true at threshold boundary', () => {
		// 80_000 = 100_000 * 0.8
		assert.equal(isOverThreshold(80_000, 100_000), true);
	});

	it('respects custom threshold', () => {
		assert.equal(isOverThreshold(60_000, 100_000, 0.5), true);
		assert.equal(isOverThreshold(40_000, 100_000, 0.5), false);
	});
});

describe('calculateUsagePercentage', () => {
	it('calculates correct percentage', () => {
		assert.equal(calculateUsagePercentage(50_000, 100_000), 50);
	});

	it('handles zero context window', () => {
		assert.equal(calculateUsagePercentage(100, 0), Infinity);
	});

	it('returns 0 for zero tokens', () => {
		assert.equal(calculateUsagePercentage(0, 100_000), 0);
	});

	it('can exceed 100%', () => {
		assert.ok(calculateUsagePercentage(150_000, 100_000) > 100);
	});
});

describe('DEFAULT_THRESHOLD', () => {
	it('is 0.8 (80%)', () => {
		assert.equal(DEFAULT_THRESHOLD, 0.8);
	});
});
