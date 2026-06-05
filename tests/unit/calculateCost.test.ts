import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCost, formatCost } from '../../src/agent/cost.ts';

describe('calculateCost', () => {
	it('returns zero cost for local/free models', () => {
		const localModels = [
			'lmstudio-community/llama-4',
			'localhost/gemma-4-31b',
			'ollama/mistral',
			'127.0.0.1/phi-4',
			'gpt-oss-20b',
			'llama-3-8b',
			'mistral-nemo',
			'gemma-2-9b',
			'phi-3-mini',
			'qwen2.5-coder',
		];

		for (const model of localModels) {
			const cost = calculateCost(model, 1000, 500);
			assert.equal(cost.totalCost, 0, `${model} should be free`);
			assert.equal(cost.inputCost, 0);
			assert.equal(cost.outputCost, 0);
		}
	});

	it('calculates cost for known cloud models', () => {
		// deepseek-chat: $0.14/M input, $0.28/M output
		const cost = calculateCost('deepseek-chat', 1_000_000, 1_000_000);
		assert.ok(Math.abs(cost.inputCost - 0.14) < 0.01);
		assert.ok(Math.abs(cost.outputCost - 0.28) < 0.01);
		assert.ok(Math.abs(cost.totalCost - 0.42) < 0.01);
	});

	it('calculates cost for deepseek-v4-pro', () => {
		const cost = calculateCost('deepseek-v4-pro', 500_000, 200_000);
		assert.ok(Math.abs(cost.inputCost - 0.07) < 0.01); // 0.14 * 0.5
		assert.ok(Math.abs(cost.outputCost - 0.056) < 0.01); // 0.28 * 0.2
	});

	it('calculates cost for deepseek-v4-flash (cheaper)', () => {
		const cost = calculateCost('deepseek-v4-flash', 1_000_000, 1_000_000);
		assert.ok(Math.abs(cost.inputCost - 0.07) < 0.01);
		assert.ok(Math.abs(cost.outputCost - 0.14) < 0.01);
	});

	it('calculates cost for GPT-4o', () => {
		const cost = calculateCost('gpt-4o', 1_000_000, 500_000);
		assert.ok(Math.abs(cost.inputCost - 2.50) < 0.01);
		assert.ok(Math.abs(cost.outputCost - 5.00) < 0.01); // 10.0 * 0.5
	});

	it('calculates cost for Claude Sonnet 4', () => {
		const cost = calculateCost('claude-sonnet-4-20250514', 100_000, 50_000);
		assert.ok(Math.abs(cost.inputCost - 0.30) < 0.01); // 3.0 * 0.1
		assert.ok(Math.abs(cost.outputCost - 0.75) < 0.01); // 15.0 * 0.05
	});

	it('returns zero for unknown models', () => {
		const cost = calculateCost('some-unknown-model', 1000000, 1000000);
		assert.equal(cost.totalCost, 0);
	});

	it('returns zero for zero tokens', () => {
		const cost = calculateCost('deepseek-chat', 0, 0);
		assert.equal(cost.totalCost, 0);
	});
});

describe('formatCost', () => {
	it('formats zero', () => {
		assert.equal(formatCost(0), '$0.00');
	});

	it('formats sub-cent values with 4 decimals', () => {
		assert.equal(formatCost(0.005), '$0.0050');
		assert.equal(formatCost(0.0099), '$0.0099');
	});

	it('formats larger values with 2 decimals', () => {
		assert.equal(formatCost(0.01), '$0.01');
		assert.equal(formatCost(1.50), '$1.50');
		assert.equal(formatCost(42.1234), '$42.12');
	});
});
