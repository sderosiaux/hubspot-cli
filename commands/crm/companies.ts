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

async function handler(
  args: ArgumentsCamelCase<CrmCompaniesArgs>
): Promise<void> {
  const { derivedAccountId, limit = 20, properties } = args;
  void trackCommandUsage('crm-companies', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : ['name', 'domain', 'industry', 'city'];

  try {
    const response = await http.get<CrmSearchResponse>(derivedAccountId, {
      url: '/crm/v3/objects/companies',
      params: {
        limit: String(limit),
        properties: props.join(','),
      },
    });

    const { results, total } = response.data;

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
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm companies', 'List companies with default properties'],
    [
      '$0 crm companies -l 50 -p "name,domain,phone"',
      'List 50 companies with custom properties',
    ],
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
