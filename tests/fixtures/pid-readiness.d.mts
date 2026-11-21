export function validatePid(pid: number): number;
export function parsePidRecord(record: string): number | null;
export function readPidRecord(path: string): Promise<string | undefined>;
export function waitForPid(path: string, options?: {
  timeoutMs?: number;
  onObservation?: (record: string | undefined, pid: number | null) => void | Promise<void>;
}): Promise<number>;
export function publishPid(path: string, pid?: number, options?: {
  onStage?: (stage: 'empty' | 'partial' | 'closed', temporary: string) => void | Promise<void>;
}): Promise<void>;
export function pidAbsent(pid: number): boolean;
