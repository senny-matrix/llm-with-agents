import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterCompatibleMessages } from '../../src/agent/system/filterMessages.ts';

describe('filterCompatibleMessages', () => {
	it('keeps user messages with string content', () => {
		const msgs = [
			{ role: 'user', content: 'Hello' },
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 1);
	});

	it('keeps system messages', () => {
		const msgs = [
			{ role: 'system', content: 'You are helpful.' },
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 1);
	});

	it('keeps assistant messages with text content', () => {
		const msgs = [
			{ role: 'assistant', content: 'Here is the answer' },
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 1);
	});

	it('keeps assistant messages with array content containing text', () => {
		const msgs = [
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Part 1' },
					{ type: 'text', text: 'Part 2' },
				],
			},
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 1);
	});

	it('keeps tool messages', () => {
		const msgs = [
			{ role: 'tool', content: 'result' },
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 1);
	});

	it('filters out assistant messages with empty content', () => {
		const msgs = [
			{ role: 'assistant', content: '' },
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 0);
	});

	it('filters out assistant messages with empty array content', () => {
		const msgs = [
			{ role: 'assistant', content: [] },
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 0);
	});

	it('filters out assistant messages with no text parts', () => {
		const msgs = [
			{
				role: 'assistant',
				content: [{ type: 'image', url: 'http://example.com' }],
			},
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 0);
	});

	it('handles mixed messages', () => {
		const msgs = [
			{ role: 'system', content: 'system' },
			{ role: 'user', content: 'user' },
			{ role: 'assistant', content: '' }, // filtered
			{ role: 'tool', content: 'tool' },
			{ role: 'assistant', content: 'good assistant' },
		] as const;
		const result = filterCompatibleMessages(msgs as never);
		assert.equal(result.length, 4); // excludes empty assistant
	});
});
