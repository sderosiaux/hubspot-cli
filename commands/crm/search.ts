import { Argv, ArgumentsCamelCase } from 'yargs';
import { http } from '@hubspot/local-dev-lib/http';
import {
  CommonArgs,
  ConfigArgs,
  AccountArgs,
  EnvironmentArgs,
  YargsCommandModule,
} from '../../types/Yargs.js';
import { logError } from '../../lib/errorHandlers/index.js';
import { commands } from '../../lang/en.js';
import { makeYargsBuilder } from '../../lib/yargsUtils.js';
import { trackCommandUsage } from '../../lib/usageTracking.js';
import {
  outputSuccess,
  outputError,
  outputTable,
  exitOk,
  exitError,
} from './_lib/output.js';

const command = 'search <object-type> <query>';
const describe = commands.crm.subcommands.search.describe;

type CrmSearchArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    query: string;
    limit?: number;
    properties?: string;
    json?: boolean;
  };

type SearchResult = {
  id: string;
  properties: Record<string, string | null>;
};

type CrmSearchResponse = {
  results: SearchResult[];
  total: number;
};

const DEFAULT_PROPERTIES: Record<string, string[]> = {
  contacts: ['firstname', 'lastname', 'email'],
  companies: ['name', 'domain'],
  deals: ['dealname', 'dealstage', 'amount'],
  tickets: ['subject', 'hs_pipeline_stage'],
};

async function handler(args: ArgumentsCamelCase<CrmSearchArgs>): Promise<void> {
  const { derivedAccountId, objectType, query, limit = 20, properties } = args;
  void trackCommandUsage('crm-search', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : DEFAULT_PROPERTIES[objectType] || ['hs_object_id'];

  try {
    const response = await http.post<CrmSearchResponse>(derivedAccountId, {
      url: `/crm/v3/objects/${objectType}/search`,
      data: {
        query,
        limit,
        properties: props,
      },
    });

    const { results, total } = response.data;

    outputSuccess(args, {
      command: 'crm.search',
      account_id: derivedAccountId,
      data: results,
      total,
    });

    const tableHeader = ['ID', ...props];
    const tableData = results.map(r => [
      r.id,
      ...props.map(p => r.properties[p] || ''),
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.search',
      derivedAccountId,
      'SEARCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function searchBuilder(yargs: Argv): Argv<CrmSearchArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets)',
      type: 'string',
    })
    .positional('query', {
      describe: 'Search query string',
      type: 'string',
    })
    .option('limit', {
      alias: 'l',
      describe: 'Max number of results',
      type: 'number',
      default: 20,
    })
    .option('properties', {
      alias: 'p',
      describe: 'Comma-separated properties to include in results',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm search contacts "john"', 'Search contacts for "john"'],
    [
      '$0 crm search deals "enterprise" -p "dealname,amount"',
      'Search deals with custom properties',
    ],
  ]);

  return yargs as Argv<CrmSearchArgs>;
}

const builder = makeYargsBuilder<CrmSearchArgs>(
  searchBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmSearchCommand: YargsCommandModule<unknown, CrmSearchArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmSearchCommand;
