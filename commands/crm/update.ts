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

const command = 'update <object-type> <id>';
const describe = 'Update an existing CRM record';

type CrmUpdateArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    id: string;
    properties?: string;
    stdin?: boolean;
    json?: boolean;
  };

type CrmObjectResponse = {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
};

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

async function handler(args: ArgumentsCamelCase<CrmUpdateArgs>): Promise<void> {
  const { derivedAccountId, objectType, id, json } = args;
  void trackCommandUsage('crm-update', {}, derivedAccountId);

  let properties: Record<string, string> | undefined;

  try {
    if (args.stdin) {
      const input = await readStdin();
      properties = JSON.parse(input.trim()) as Record<string, string>;
    } else if (args.properties) {
      properties = JSON.parse(args.properties) as Record<string, string>;
    } else {
      outputError(
        args,
        'crm.update',
        derivedAccountId,
        'MISSING_PROPERTIES',
        'Provide properties via --properties/-p (JSON string) or --stdin'
      );
      return exitError();
    }
  } catch {
    outputError(
      args,
      'crm.update',
      derivedAccountId,
      'INVALID_JSON',
      'Invalid JSON in properties input'
    );
    return exitError();
  }

  if (!properties) return exitError();

  try {
    const response = await http.patch<CrmObjectResponse>(derivedAccountId, {
      url: `/crm/v3/objects/${objectType}/${id}`,
      data: { properties },
    });

    const record = response.data;

    outputSuccess(args, {
      command: 'crm.update',
      account_id: derivedAccountId,
      data: {
        id: record.id,
        properties: record.properties,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    });

    if (!json) {
      for (const [key, value] of Object.entries(record.properties)) {
        uiLogger.log(`  ${key}: ${value ?? ''}`);
      }
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.update',
      derivedAccountId,
      'UPDATE_FAILED',
      String(err)
    );
    exitError();
  }
}

function updateBuilder(yargs: Argv): Argv<CrmUpdateArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets, etc.)',
      type: 'string',
    })
    .positional('id', {
      describe: 'Record ID to update',
      type: 'string',
    })
    .option('properties', {
      alias: 'p',
      describe:
        'JSON string of properties to update, e.g. \'{"firstname":"Jane"}\'',
      type: 'string',
    })
    .option('stdin', {
      describe: 'Read properties JSON from stdin (for LLM piping)',
      type: 'boolean',
      default: false,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    [
      '$0 crm update contacts 12345 -p \'{"firstname":"Jane"}\'',
      'Update a contact name',
    ],
    [
      'echo \'{"amount":"50000"}\' | $0 crm update deals 789 --stdin',
      'Update a deal from stdin',
    ],
    [
      '$0 crm update contacts 12345 -p \'{"email":"new@x.com"}\' --json',
      'Update and get JSON output',
    ],
  ]);

  return yargs as Argv<CrmUpdateArgs>;
}

const builder = makeYargsBuilder<CrmUpdateArgs>(
  updateBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmUpdateCommand: YargsCommandModule<unknown, CrmUpdateArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmUpdateCommand;
