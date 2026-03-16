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

const command = 'get <object-type> <id>';
const describe = 'Get a single CRM record by ID';

type CrmGetArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    id: string;
    properties?: string;
    json?: boolean;
  };

type CrmObjectResponse = {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
};

async function handler(args: ArgumentsCamelCase<CrmGetArgs>): Promise<void> {
  const { derivedAccountId, objectType, id, properties, json } = args;
  void trackCommandUsage('crm-get', {}, derivedAccountId);

  const params: Record<string, string> = {};
  if (properties) {
    params.properties = properties
      .split(',')
      .map(p => p.trim())
      .join(',');
  }

  try {
    const response = await http.get<CrmObjectResponse>(derivedAccountId, {
      url: `/crm/v3/objects/${objectType}/${id}`,
      params,
    });

    const record = response.data;

    outputSuccess(args, {
      command: 'crm.get',
      account_id: derivedAccountId,
      data: {
        id: record.id,
        properties: record.properties,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    });

    if (!json) {
      const entries = Object.entries(record.properties);
      for (const [key, value] of entries) {
        uiLogger.log(`  ${key}: ${value ?? ''}`);
      }

      uiLogger.log('');
      uiLogger.log(`  createdAt: ${record.createdAt}`);
      uiLogger.log(`  updatedAt: ${record.updatedAt}`);
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(args, 'crm.get', derivedAccountId, 'GET_FAILED', String(err));
    exitError();
  }
}

function getBuilder(yargs: Argv): Argv<CrmGetArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets, etc.)',
      type: 'string',
    })
    .positional('id', {
      describe: 'Record ID',
      type: 'string',
    })
    .option('properties', {
      alias: 'p',
      describe: 'Comma-separated list of properties to return',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm get contacts 12345', 'Get a contact by ID'],
    [
      '$0 crm get deals 789 -p "dealname,amount,dealstage"',
      'Get a deal with specific properties',
    ],
    ['$0 crm get contacts 12345 --json', 'Get contact as JSON'],
  ]);

  return yargs as Argv<CrmGetArgs>;
}

const builder = makeYargsBuilder<CrmGetArgs>(getBuilder, command, describe, {
  useGlobalOptions: true,
  useConfigOptions: true,
  useAccountOptions: true,
  useEnvironmentOptions: true,
});

const crmGetCommand: YargsCommandModule<unknown, CrmGetArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmGetCommand;
