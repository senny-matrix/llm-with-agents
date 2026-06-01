import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ModelMessage } from 'ai';

const SESSION_DIR = resolve(homedir(), '.agi', 'sessions');

export interface SessionMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  modelName: string;
  messageCount: number;
}

export interface Session {
  meta: SessionMeta;
  messages: ModelMessage[];
}

function ensureDir() {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function sessionPath(id: string): string {
  return resolve(SESSION_DIR, `${id}.json`);
}

export function generateSessionId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `session-${stamp}`;
}

export function saveSession(session: Session): void {
  ensureDir();
  session.meta.updatedAt = new Date().toISOString();
  session.meta.messageCount = session.messages.length;
  writeFileSync(sessionPath(session.meta.id), JSON.stringify(session, null, 2));
}

export function loadSession(id: string): Session | null {
  ensureDir();
  const p = sessionPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function listSessions(): SessionMeta[] {
  ensureDir();
  const files = readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
  const sessions: SessionMeta[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(resolve(SESSION_DIR, f), 'utf8'));
      sessions.push(data.meta);
    } catch {
      // skip corrupted files
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string): boolean {
  const p = sessionPath(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}
