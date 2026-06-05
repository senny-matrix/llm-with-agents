import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	estimateTokens,
	extractMessageText,
	estimateMessagesTokens,
} from '../../src/agent/context/tokenEstimator.ts';

describe('estimateTokens', () => {
	it('estimates tokens from text length', () => {
		// 3.75 chars per token means 37.5 chars ≈ 10 tokens
		assert.equal(estimateTokens('a'.repeat(37)), 10);
		assert.equal(estimateTokens('a'.repeat(38)), 11); // ceil(38/3.75) = 11
	});

	it('returns 1 token for very short strings', () => {
		assert.equal(estimateTokens(''), 0);
		assert.equal(estimateTokens('hi'), 1);
	});

	it('handles empty string', () => {
		assert.equal(estimateTokens(''), 0);
	});
});

describe('extractMessageText', () => {
	it('extracts string content', () => {
		const msg = { role: 'user', content: 'Hello world' } as const;
		assert.equal(extractMessageText(msg as never), 'Hello world');
	});

	it('extracts array content with text parts', () => {
		const msg = {
			role: 'assistant',
			content: [
				{ type: 'text', text: 'Part 1' },
				{ type: 'text', text: 'Part 2' },
			],
		} as const;
		const result = extractMessageText(msg as never);
		assert.ok(result.includes('Part 1'));
		assert.ok(result.includes('Part 2'));
	});

	it('handles string parts in array', () => {
		const msg = {
			role: 'user',
			content: ['Hello', 'world'] as const,
		} as const;
		assert.equal(extractMessageText(msg as never), 'Hello world');
	});

	it('handles tool result parts with value', () => {
		const msg = {
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'abc',
					toolName: 'readFile',
					output: { type: 'text', value: 'file contents' },
				},
			],
		} as const;
		const result = extractMessageText(msg as never);
		assert.ok(result.includes('file contents'));
	});

	it('stringifies unknown part shapes', () => {
		const msg = {
			role: 'assistant',
			content: [{ type: 'image', url: 'http://example.com/img.png' }],
		} as const;
		const result = extractMessageText(msg as never);
		assert.ok(result.includes('http://example.com'));
	});
});

describe('estimateMessagesTokens', () => {
	it('separates input and output tokens', () => {
		const messages = [
			{ role: 'system', content: 'You are helpful.' },
			{ role: 'user', content: 'What is 2+2?' },
			{ role: 'assistant', content: '4' },
		] as const;

		const usage = estimateMessagesTokens(messages as never);
		assert.ok(usage.input > 0, 'should have input tokens');
		assert.ok(usage.output > 0, 'should have output tokens');
		assert.equal(usage.total, usage.input + usage.output);
	});

	it('counts tool messages as input', () => {
		const messages = [
			{ role: 'tool', content: 'result text here' },
		] as const;

		const usage = estimateMessagesTokens(messages as never);
		assert.ok(usage.input > 0);
		assert.equal(usage.output, 0);
	});

	it('returns zero for empty array', () => {
		const usage = estimateMessagesTokens([]);
		assert.equal(usage.input, 0);
		assert.equal(usage.output, 0);
		assert.equal(usage.total, 0);
	});
});
