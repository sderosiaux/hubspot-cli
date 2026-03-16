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

const command = 'create <object-type>';
const describe = 'Create a new CRM record';

type CrmCreateArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
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

async function handler(args: ArgumentsCamelCase<CrmCreateArgs>): Promise<void> {
  const { derivedAccountId, objectType, json } = args;
  void trackCommandUsage('crm-create', {}, derivedAccountId);

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
        'crm.create',
        derivedAccountId,
        'MISSING_PROPERTIES',
        'Provide properties via --properties/-p (JSON string) or --stdin'
      );
      return exitError();
    }
  } catch {
    outputError(
      args,
      'crm.create',
      derivedAccountId,
      'INVALID_JSON',
      'Invalid JSON in properties input'
    );
    return exitError();
  }

  if (!properties) return exitError();

  try {
    const response = await http.post<CrmObjectResponse>(derivedAccountId, {
      url: `/crm/v3/objects/${objectType}`,
      data: { properties },
    });

    const record = response.data;

    outputSuccess(args, {
      command: 'crm.create',
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
      'crm.create',
      derivedAccountId,
      'CREATE_FAILED',
      String(err)
    );
    exitError();
  }
}

function createBuilder(yargs: Argv): Argv<CrmCreateArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets, etc.)',
      type: 'string',
    })
    .option('properties', {
      alias: 'p',
      describe:
        'JSON string of properties, e.g. \'{"firstname":"John","email":"j@x.com"}\'',
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
      '$0 crm create contacts -p \'{"firstname":"John","email":"j@x.com"}\'',
      'Create a contact',
    ],
    [
      'echo \'{"dealname":"Big Deal","amount":"10000"}\' | $0 crm create deals --stdin',
      'Create a deal from stdin',
    ],
    [
      '$0 crm create contacts -p \'{"firstname":"Jane"}\' --json',
      'Create and get JSON output',
    ],
  ]);

  return yargs as Argv<CrmCreateArgs>;
}

const builder = makeYargsBuilder<CrmCreateArgs>(
  createBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmCreateCommand: YargsCommandModule<unknown, CrmCreateArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmCreateCommand;
