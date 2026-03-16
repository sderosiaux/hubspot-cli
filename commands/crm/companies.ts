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

const command = ['companies', 'company'];
const describe = commands.crm.subcommands.companies.describe;

type CrmCompaniesArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    limit?: number;
    properties?: string;
    owner?: string;
    industry?: string;
    after?: string;
    before?: string;
    json?: boolean;
  };

type CompanyResult = {
  id: string;
  properties: Record<string, string | null>;
};

type CrmSearchResponse = {
  results: CompanyResult[];
  total: number;
};

type SearchFilter = {
  propertyName: string;
  operator: string;
  value?: string;
};

function buildFilters(
  args: ArgumentsCamelCase<CrmCompaniesArgs>
): SearchFilter[] {
  const filters: SearchFilter[] = [];
  if (args.owner) {
    filters.push({
      propertyName: 'hubspot_owner_id',
      operator: 'EQ',
      value: args.owner,
    });
  }
  if (args.industry) {
    filters.push({
      propertyName: 'industry',
      operator: 'EQ',
      value: args.industry,
    });
  }
  if (args.after) {
    filters.push({
      propertyName: 'createdate',
      operator: 'GTE',
      value: new Date(args.after).valueOf().toString(),
    });
  }
  if (args.before) {
    filters.push({
      propertyName: 'createdate',
      operator: 'LTE',
      value: new Date(args.before).valueOf().toString(),
    });
  }
  return filters;
}

async function handler(
  args: ArgumentsCamelCase<CrmCompaniesArgs>
): Promise<void> {
  const { derivedAccountId, limit = 20, properties } = args;
  void trackCommandUsage('crm-companies', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : ['name', 'domain', 'industry', 'city'];

  const filters = buildFilters(args);
  const hasFilters = filters.length > 0;

  try {
    let results: CompanyResult[];
    let total: number;

    if (hasFilters) {
      const response = await http.post<CrmSearchResponse>(derivedAccountId, {
        url: '/crm/v3/objects/companies/search',
        data: {
          filterGroups: [{ filters }],
          properties: props,
          limit: Math.min(limit, 100),
          sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        },
      });
      results = response.data.results;
      total = response.data.total;
    } else {
      const response = await http.get<CrmSearchResponse>(derivedAccountId, {
        url: '/crm/v3/objects/companies',
        params: {
          limit: String(limit),
          properties: props.join(','),
        },
      });
      results = response.data.results;
      total = response.data.total;
    }

    outputSuccess(args, {
      command: 'crm.companies',
      account_id: derivedAccountId,
      data: results,
      total,
    });

    const tableHeader = ['ID', ...props];
    const tableData = results.map(c => [
      c.id,
      ...props.map(p => c.properties[p] || ''),
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.companies',
      derivedAccountId,
      'COMPANIES_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function companiesBuilder(yargs: Argv): Argv<CrmCompaniesArgs> {
  yargs
    .option('limit', {
      alias: 'l',
      describe: 'Max number of companies to return',
      type: 'number',
      default: 20,
    })
    .option('properties', {
      alias: 'p',
      describe:
        'Comma-separated list of properties (default: name,domain,industry,city)',
      type: 'string',
    })
    .option('owner', {
      describe: 'Filter by owner ID',
      type: 'string',
    })
    .option('industry', {
      describe: 'Filter by industry value',
      type: 'string',
    })
    .option('after', {
      describe: 'Filter companies created >= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('before', {
      describe: 'Filter companies created <= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm companies', 'List companies with default properties'],
    ['$0 crm companies --industry COMPUTER_SOFTWARE', 'Filter by industry'],
    ['$0 crm companies --after 2026-01-01', 'Companies created in 2026'],
  ]);

  return yargs as Argv<CrmCompaniesArgs>;
}

const builder = makeYargsBuilder<CrmCompaniesArgs>(
  companiesBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmCompaniesCommand: YargsCommandModule<unknown, CrmCompaniesArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmCompaniesCommand;
