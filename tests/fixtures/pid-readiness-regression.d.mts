import type { ChildProcess } from 'node:child_process';
export function bounded<T>(promise: Promise<T>, label: string): Promise<T>;
export function readingRegression(original?: boolean, initial?: string): Promise<void>;
export function publisher(mode: string, path: string, initial?: string): {
  child: ChildProcess;
  closed: Promise<[number | null, NodeJS.Signals | null]>;
  release(): void;
  next(): Promise<{ stage: string; temporary: string; pid: number }>;
  stop(): Promise<void>;
};
