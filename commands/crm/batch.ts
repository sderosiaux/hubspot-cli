import { Argv, ArgumentsCamelCase } from 'yargs';
import { http } from '@hubspot/local-dev-lib/http';
import {
  CommonArgs,
  ConfigArgs,
  AccountArgs,
  EnvironmentArgs,
  YargsCommandModule,
} from '../../types/Yargs.js';
import { uiLogger } from '../../lib/ui/logger.js';
import { logError } from '../../lib/errorHandlers/index.js';
import { makeYargsBuilder } from '../../lib/yargsUtils.js';
import { trackCommandUsage } from '../../lib/usageTracking.js';
import {
  outputSuccess,
  outputError,
  exitOk,
  exitError,
} from './_lib/output.js';

const command = 'batch <operation> <object-type>';
const describe = 'Batch create, update, or archive CRM records from stdin JSON';

type CrmBatchArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    operation: string;
    objectType: string;
    json?: boolean;
  };

type BatchResultItem = {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
};

type BatchResponse = {
  status: string;
  results: BatchResultItem[];
  errors?: { message: string; context?: Record<string, string[]> }[];
};

const VALID_OPERATIONS = ['create', 'update', 'archive'];

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk.toString();
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function handler(args: ArgumentsCamelCase<CrmBatchArgs>): Promise<void> {
  const { derivedAccountId, operation, objectType, json } = args;
  void trackCommandUsage('crm-batch', {}, derivedAccountId);

  if (!VALID_OPERATIONS.includes(operation)) {
    outputError(
      args,
      'crm.batch',
      derivedAccountId,
      'INVALID_OPERATION',
      `Invalid operation "${operation}". Valid operations: ${VALID_OPERATIONS.join(', ')}`
    );
    return exitError();
  }

  let inputs: Record<string, unknown>[] | undefined;

  try {
    const raw = await readStdin();
    const parsed: unknown = JSON.parse(raw.trim());

    if (!Array.isArray(parsed)) {
      outputError(
        args,
        'crm.batch',
        derivedAccountId,
        'INVALID_INPUT',
        'Stdin must be a JSON array of objects'
      );
      return exitError();
    }
    inputs = parsed;
  } catch {
    outputError(
      args,
      'crm.batch',
      derivedAccountId,
      'INVALID_JSON',
      'Invalid JSON from stdin. Expected a JSON array.'
    );
    return exitError();
  }

  if (!inputs) return exitError();

  // Format inputs based on operation
  let body: Record<string, unknown>;

  if (operation === 'archive') {
    // Archive expects [{id: "123"}, ...]
    body = {
      inputs: inputs.map(item => ({
        id: item.id ?? item,
      })),
    };
  } else if (operation === 'create') {
    // Create expects [{properties: {...}}, ...]
    body = {
      inputs: inputs.map(item =>
        item.properties ? item : { properties: item }
      ),
    };
  } else {
    // Update expects [{id: "123", properties: {...}}, ...]
    body = { inputs };
  }

  try {
    const response = await http.post<BatchResponse>(derivedAccountId, {
      url: `/crm/v3/objects/${objectType}/batch/${operation}`,
      data: body,
    });

    const result = response.data;

    outputSuccess(args, {
      command: 'crm.batch',
      account_id: derivedAccountId,
      data: {
        operation,
        objectType,
        status: result.status,
        results: result.results,
        total: result.results?.length ?? 0,
        errors: result.errors,
      },
    });

    if (!json) {
      const count = result.results?.length ?? 0;
      uiLogger.success(
        `Batch ${operation} completed: ${count} ${objectType} records processed`
      );

      if (result.errors && result.errors.length > 0) {
        uiLogger.warn(`${result.errors.length} errors occurred:`);
        for (const err of result.errors) {
          uiLogger.log(`  - ${err.message}`);
        }
      }
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.batch',
      derivedAccountId,
      'BATCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function batchBuilder(yargs: Argv): Argv<CrmBatchArgs> {
  yargs
    .positional('operation', {
      describe: 'Batch operation: create, update, or archive',
      type: 'string',
      choices: VALID_OPERATIONS,
    })
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets, etc.)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    [
      'echo \'[{"firstname":"A","email":"a@x.com"},{"firstname":"B","email":"b@x.com"}]\' | $0 crm batch create contacts',
      'Batch create contacts from stdin',
    ],
    [
      'echo \'[{"id":"1","properties":{"firstname":"Updated"}}]\' | $0 crm batch update contacts',
      'Batch update contacts from stdin',
    ],
    [
      'echo \'[{"id":"1"},{"id":"2"}]\' | $0 crm batch archive contacts',
      'Batch archive contacts from stdin',
    ],
    [
      "echo '[...]' | $0 crm batch create deals --json",
      'Batch create with JSON output',
    ],
  ]);

  return yargs as Argv<CrmBatchArgs>;
}

const builder = makeYargsBuilder<CrmBatchArgs>(
  batchBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmBatchCommand: YargsCommandModule<unknown, CrmBatchArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmBatchCommand;
