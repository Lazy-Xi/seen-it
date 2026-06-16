import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, vi } from 'vitest';

export let storedState: Record<string, any> = {};

const { mockFire } = vi.hoisted(() => {
  const mockFire = vi.fn();
  return { mockFire };
});

vi.mock('vscode', () => {
  class EventEmitter<T = void> {
    event = vi.fn();
    fire = mockFire;
    dispose = vi.fn();
  }
  return {
    EventEmitter,
    Uri: {
      file: (fsPath: string) => ({
        fsPath: require('path').normalize(fsPath),
        toString: () => `file://${require('path').normalize(fsPath)}`,
      }),
    },
    workspace: { textDocuments: [] },
  };
});

vi.mock('../extension', () => ({ log: vi.fn() }));

import { ReviewTracker } from '../reviewTracker';

export function createTracker(stored?: Record<string, any>): ReviewTracker {
  storedState = stored ?? {};
  return new ReviewTracker({
    workspaceState: {
      get: (key: string) => storedState[key],
      update: (key: string, value: any) => { storedState[key] = value; },
    },
  } as any);
}

let tmpDir: string;

export function tmpFile(name: string): string {
  return path.join(tmpDir, name);
}

export function writeFile(name: string, content: string): string {
  const p = tmpFile(name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

export function uri(name: string) {
  return { fsPath: path.normalize(tmpFile(name)), toString: () => tmpFile(name) } as any;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seen-it-test-'));
  mockFire.mockClear();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
