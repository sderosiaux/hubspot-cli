import { uiLogger } from '../../../lib/ui/logger.js';
import { renderTable } from '../../../ui/render.js';
import { EXIT_CODES } from '../../../lib/enums/exitCodes.js';

export type CrmEnvelope<T = unknown> = {
  ok: boolean;
  command: string;
  account_id: number;
  data: T;
  total?: number;
  next_cursor?: string | null;
  error?: { code: string; message: string };
};

export function isJsonMode(args: { json?: boolean }): boolean {
  return args.json === true;
}

// Flush stdout before exiting — prevents truncated JSON on large outputs
function flushAndExit(code: number): void {
  if (process.stdout.writableFinished) {
    process.exit(code);
  }
  process.stdout.write('', () => {
    process.exit(code);
  });
  // Fallback if drain doesn't fire
  setTimeout(() => process.exit(code), 200);
}

export function exitOk(): void {
  flushAndExit(EXIT_CODES.SUCCESS);
}

export function exitError(): void {
  flushAndExit(EXIT_CODES.ERROR);
}

// Success output
export function outputSuccess<T>(
  args: { json?: boolean },
  envelope: Omit<CrmEnvelope<T>, 'ok'>
): void {
  if (isJsonMode(args)) {
    console.log(JSON.stringify({ ok: true, ...envelope }, null, 2));
    return;
  }
  uiLogger.success(
    `[${envelope.command}] account ${envelope.account_id}${envelope.total !== undefined ? ` (${envelope.total} results)` : ''}`
  );
}

// Error output
export function outputError(
  args: { json?: boolean },
  command: string,
  accountId: number,
  code: string,
  message: string
): void {
  if (isJsonMode(args)) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          command,
          account_id: accountId,
          data: null,
          error: { code, message },
        },
        null,
        2
      )
    );
    return;
  }
  uiLogger.error(`[${command}] ${message}`);
}

// Render table (no-op in JSON mode)
export function outputTable(
  args: { json?: boolean },
  headers: string[],
  rows: string[][]
): void {
  if (isJsonMode(args)) return;
  if (rows.length > 0) {
    uiLogger.log('');
    void renderTable(headers, rows);
  }
}
