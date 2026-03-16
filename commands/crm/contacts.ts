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

const command = ['contacts', 'contact'];
const describe = commands.crm.subcommands.contacts.describe;

type CrmContactsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    limit?: number;
    properties?: string;
    owner?: string;
    lifecycle?: string;
    after?: string;
    before?: string;
    json?: boolean;
  };

type ContactResult = {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
};

type CrmSearchResponse = {
  results: ContactResult[];
  total: number;
  paging?: { next?: { after: string } };
};

type SearchFilter = {
  propertyName: string;
  operator: string;
  value?: string;
};

function buildFilters(
  args: ArgumentsCamelCase<CrmContactsArgs>
): SearchFilter[] {
  const filters: SearchFilter[] = [];
  if (args.owner) {
    filters.push({
      propertyName: 'hubspot_owner_id',
      operator: 'EQ',
      value: args.owner,
    });
  }
  if (args.lifecycle) {
    filters.push({
      propertyName: 'lifecyclestage',
      operator: 'EQ',
      value: args.lifecycle.toLowerCase(),
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
  args: ArgumentsCamelCase<CrmContactsArgs>
): Promise<void> {
  const { derivedAccountId, limit = 20, properties } = args;
  void trackCommandUsage('crm-contacts', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : ['firstname', 'lastname', 'email', 'company'];

  const filters = buildFilters(args);
  const hasFilters = filters.length > 0;

  try {
    let results: ContactResult[];
    let total: number;

    if (hasFilters) {
      const response = await http.post<CrmSearchResponse>(derivedAccountId, {
        url: '/crm/v3/objects/contacts/search',
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
        url: '/crm/v3/objects/contacts',
        params: {
          limit: String(limit),
          properties: props.join(','),
        },
      });
      results = response.data.results;
      total = response.data.total;
    }

    outputSuccess(args, {
      command: 'crm.contacts',
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
      'crm.contacts',
      derivedAccountId,
      'CONTACTS_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function contactsBuilder(yargs: Argv): Argv<CrmContactsArgs> {
  yargs
    .option('limit', {
      alias: 'l',
      describe: 'Max number of contacts to return',
      type: 'number',
      default: 20,
    })
    .option('properties', {
      alias: 'p',
      describe:
        'Comma-separated list of properties to include (default: firstname,lastname,email,company)',
      type: 'string',
    })
    .option('owner', {
      describe: 'Filter by owner ID',
      type: 'string',
    })
    .option('lifecycle', {
      describe:
        'Filter by lifecycle stage (subscriber, lead, marketingqualifiedlead, salesqualifiedlead, opportunity, customer, evangelist, other)',
      type: 'string',
    })
    .option('after', {
      describe: 'Filter contacts created >= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('before', {
      describe: 'Filter contacts created <= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm contacts', 'List contacts with default properties'],
    ['$0 crm contacts --lifecycle customer', 'List customers only'],
    ['$0 crm contacts --after 2026-01-01 -l 50', 'Contacts created in 2026'],
  ]);

  return yargs as Argv<CrmContactsArgs>;
}

const builder = makeYargsBuilder<CrmContactsArgs>(
  contactsBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmContactsCommand: YargsCommandModule<unknown, CrmContactsArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmContactsCommand;
