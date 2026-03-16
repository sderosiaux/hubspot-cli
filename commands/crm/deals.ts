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
    stage?: string;
    after?: string;
    before?: string;
    pipeline?: string;
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

type SearchFilter = {
  propertyName: string;
  operator: string;
  value?: string;
};

function buildFilters(args: ArgumentsCamelCase<CrmDealsArgs>): SearchFilter[] {
  const filters: SearchFilter[] = [];

  if (args.stage) {
    const raw = args.stage.toLowerCase();

    if (raw === 'won') {
      filters.push({
        propertyName: 'hs_is_closed_won',
        operator: 'EQ',
        value: 'true',
      });
    } else if (raw === 'lost') {
      filters.push(
        {
          propertyName: 'hs_is_closed',
          operator: 'EQ',
          value: 'true',
        },
        {
          propertyName: 'hs_is_closed_won',
          operator: 'EQ',
          value: 'false',
        }
      );
    } else if (raw === 'open') {
      filters.push({
        propertyName: 'hs_is_closed',
        operator: 'EQ',
        value: 'false',
      });
    } else {
      // Assume raw stage ID
      filters.push({
        propertyName: 'dealstage',
        operator: 'EQ',
        value: raw,
      });
    }
  }

  if (args.pipeline) {
    filters.push({
      propertyName: 'pipeline',
      operator: 'EQ',
      value: args.pipeline,
    });
  }

  if (args.after) {
    filters.push({
      propertyName: 'closedate',
      operator: 'GTE',
      value: new Date(args.after).valueOf().toString(),
    });
  }

  if (args.before) {
    filters.push({
      propertyName: 'closedate',
      operator: 'LTE',
      value: new Date(args.before).valueOf().toString(),
    });
  }

  return filters;
}

async function handler(args: ArgumentsCamelCase<CrmDealsArgs>): Promise<void> {
  const { derivedAccountId, limit = 20, properties } = args;
  void trackCommandUsage('crm-deals', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : ['dealname', 'dealstage', 'amount', 'closedate'];

  const filters = buildFilters(args);
  const hasFilters = filters.length > 0;

  try {
    let results: DealResult[];
    let total: number;

    if (hasFilters) {
      // Use search API when filters are present
      const response = await http.post<CrmSearchResponse>(derivedAccountId, {
        url: '/crm/v3/objects/deals/search',
        data: {
          filterGroups: [{ filters }],
          properties: props,
          limit: Math.min(limit, 100),
          sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
        },
      });
      results = response.data.results;
      total = response.data.total;
    } else {
      const response = await http.get<CrmSearchResponse>(derivedAccountId, {
        url: '/crm/v3/objects/deals',
        params: {
          limit: String(limit),
          properties: props.join(','),
        },
      });
      results = response.data.results;
      total = response.data.total;
    }

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
    .option('stage', {
      alias: 's',
      describe: 'Filter by deal stage (ID, or alias: won, lost, open)',
      type: 'string',
    })
    .option('pipeline', {
      describe: 'Filter by pipeline ID',
      type: 'string',
    })
    .option('after', {
      describe: 'Filter deals with closedate >= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('before', {
      describe: 'Filter deals with closedate <= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm deals', 'List deals with default properties'],
    ['$0 crm deals -s won --after 2026-01-01', 'Won deals in 2026'],
    ['$0 crm deals -s open -l 50', 'Open deals'],
    ['$0 crm deals --pipeline 36825126 -s lost', 'Lost deals in a pipeline'],
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
