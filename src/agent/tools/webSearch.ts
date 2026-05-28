import { tool } from 'ai';
import { z } from 'zod';

/**
 * Web search tool for the agent.
 *
 * Supports multiple search backends. Configure via SEARCH_BACKEND env var:
 *   - "google" (default) — Google Custom Search JSON API (100 free queries/day)
 *   - "serper"           — Serper.dev (paid, very reliable)
 *
 * Required env vars by backend:
 *   google: GOOGLE_API_KEY + GOOGLE_CSE_ID
 *   serper:  SERPER_API_KEY
 *
 * If no backend is configured, returns a helpful error message.
 */

// ---------------------------------------------------------------------------
// Google Custom Search backend (free tier: 100 queries/day)
// Get keys at: https://programmablesearchengine.google.com/
// ---------------------------------------------------------------------------
async function googleSearch(query: string, maxResults = 5): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  const url =
    `https://www.googleapis.com/customsearch/v1?` +
    new URLSearchParams({
      key: apiKey!,
      cx: cseId!,
      q: query,
      num: String(maxResults),
    });

  const response = await fetch(url);
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google CSE error ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = (await response.json()) as {
    items?: { title: string; link: string; snippet: string }[];
  };

  const items = data.items ?? [];
  if (items.length === 0) return `No results found for "${query}".`;

  return items
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Serper.dev backend (paid, fast, great results)
// Get key at: https://serper.dev/
// ---------------------------------------------------------------------------
async function serperSearch(query: string, maxResults = 5): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY;

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: maxResults }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Serper error ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = (await response.json()) as {
    organic?: { title: string; link: string; snippet: string }[];
  };

  const items = data.organic ?? [];
  if (items.length === 0) return `No results found for "${query}".`;

  return items
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
async function performSearch(query: string): Promise<string> {
  const backend = (process.env.SEARCH_BACKEND || 'google').toLowerCase();

  switch (backend) {
    case 'google': {
      if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CSE_ID) {
        return (
          'Web search is not configured. Set up one of these backends:\n\n' +
          '  Google Custom Search (free, 100 queries/day):\n' +
          '    1. Get API key: https://console.cloud.google.com/apis/credentials\n' +
          '    2. Create CSE:   https://programmablesearchengine.google.com/\n' +
          '    3. Set in .env:  GOOGLE_API_KEY=...  GOOGLE_CSE_ID=...\n\n' +
          '  Serper.dev (paid, very reliable):\n' +
          '    1. Get key: https://serper.dev/\n' +
          '    2. Set in .env: SEARCH_BACKEND=serper  SERPER_API_KEY=...'
        );
      }
      return googleSearch(query);
    }
    case 'serper': {
      if (!process.env.SERPER_API_KEY) {
        return 'Serper API key not set. Add SERPER_API_KEY to your .env file.';
      }
      return serperSearch(query);
    }
    default:
      return `Unknown search backend "${backend}". Supported: google, serper.`;
  }
}

export const webSearch = tool({
  description:
    'Search the web for current information. Use this when you need up-to-date facts, ' +
    'news, or information beyond your knowledge cutoff.',
  inputSchema: z.object({
    query: z.string().describe('The search query to look up on the web'),
  }),
  execute: async ({ query }: { query: string }) => {
    try {
      return await performSearch(query);
    } catch (error) {
      return `Web search failed: ${(error as Error).message}`;
    }
  },
});
