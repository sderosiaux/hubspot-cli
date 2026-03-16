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

const command = ['deals', 'deal'];
const describe = commands.crm.subcommands.deals.describe;

type CrmDealsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    limit?: number;
    properties?: string;
    json?: boolean;
  };

type DealResult = {
  id: string;
  properties: Record<string, string | null>;
};

type CrmSearchResponse = {
  results: DealResult[];
  total: number;
};

async function handler(args: ArgumentsCamelCase<CrmDealsArgs>): Promise<void> {
  const { derivedAccountId, limit = 20, properties } = args;
  void trackCommandUsage('crm-deals', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : ['dealname', 'dealstage', 'amount', 'closedate'];

  try {
    const response = await http.get<CrmSearchResponse>(derivedAccountId, {
      url: '/crm/v3/objects/deals',
      params: {
        limit: String(limit),
        properties: props.join(','),
      },
    });

    const { results, total } = response.data;

    outputSuccess(args, {
      command: 'crm.deals',
      account_id: derivedAccountId,
      data: results,
      total,
    });

    const tableHeader = ['ID', ...props];
    const tableData = results.map(d => [
      d.id,
      ...props.map(p => d.properties[p] || ''),
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.deals',
      derivedAccountId,
      'DEALS_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function dealsBuilder(yargs: Argv): Argv<CrmDealsArgs> {
  yargs
    .option('limit', {
      alias: 'l',
      describe: 'Max number of deals to return',
      type: 'number',
      default: 20,
    })
    .option('properties', {
      alias: 'p',
      describe:
        'Comma-separated list of properties (default: dealname,dealstage,amount,closedate)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm deals', 'List deals with default properties'],
    [
      '$0 crm deals -l 50 -p "dealname,amount,pipeline"',
      'List 50 deals with custom properties',
    ],
  ]);

  return yargs as Argv<CrmDealsArgs>;
}

const builder = makeYargsBuilder<CrmDealsArgs>(
  dealsBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmDealsCommand: YargsCommandModule<unknown, CrmDealsArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmDealsCommand;
