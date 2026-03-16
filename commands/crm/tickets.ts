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
import { makeYargsBuilder } from '../../lib/yargsUtils.js';
import { trackCommandUsage } from '../../lib/usageTracking.js';
import {
  outputSuccess,
  outputError,
  outputTable,
  exitOk,
  exitError,
} from './_lib/output.js';

const command = ['tickets', 'ticket'];
const describe = 'List CRM tickets';

type CrmTicketsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    limit?: number;
    properties?: string;
    stage?: string;
    priority?: string;
    pipeline?: string;
    after?: string;
    before?: string;
    json?: boolean;
  };

type TicketResult = {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
};

type CrmListResponse = {
  results: TicketResult[];
  total: number;
  paging?: { next?: { after: string } };
};

const DEFAULT_PROPERTIES = [
  'subject',
  'content',
  'hs_pipeline_stage',
  'hs_ticket_priority',
  'createdate',
];

type SearchFilter = {
  propertyName: string;
  operator: string;
  value?: string;
};

function buildFilters(
  args: ArgumentsCamelCase<CrmTicketsArgs>
): SearchFilter[] {
  const filters: SearchFilter[] = [];
  if (args.stage) {
    const raw = args.stage.toLowerCase();
    if (raw === 'open') {
      filters.push({
        propertyName: 'hs_ticket_priority',
        operator: 'HAS_PROPERTY',
      });
      // open = not closed, use hs_pipeline_stage != closed stages
      // Simpler: filter by hs_is_closed if available, else use stage ID
      // HubSpot tickets don't have hs_is_closed, so use stage ID directly
    } else {
      filters.push({
        propertyName: 'hs_pipeline_stage',
        operator: 'EQ',
        value: raw,
      });
    }
  }
  if (args.priority) {
    filters.push({
      propertyName: 'hs_ticket_priority',
      operator: 'EQ',
      value: args.priority.toUpperCase(),
    });
  }
  if (args.pipeline) {
    filters.push({
      propertyName: 'hs_pipeline',
      operator: 'EQ',
      value: args.pipeline,
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
  args: ArgumentsCamelCase<CrmTicketsArgs>
): Promise<void> {
  const { derivedAccountId, limit = 20, properties } = args;
  void trackCommandUsage('crm-tickets', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : DEFAULT_PROPERTIES;

  const filters = buildFilters(args);
  const hasFilters = filters.length > 0;

  try {
    let results: TicketResult[];
    let total: number;
    let nextCursor: string | undefined;

    if (hasFilters) {
      const response = await http.post<CrmListResponse>(derivedAccountId, {
        url: '/crm/v3/objects/tickets/search',
        data: {
          filterGroups: [{ filters }],
          properties: props,
          limit: Math.min(limit, 100),
          sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        },
      });
      results = response.data.results;
      total = response.data.total;
      nextCursor = response.data.paging?.next?.after;
    } else {
      const response = await http.get<CrmListResponse>(derivedAccountId, {
        url: '/crm/v3/objects/tickets',
        params: {
          limit: String(limit),
          properties: props.join(','),
        },
      });
      results = response.data.results;
      total = response.data.total;
      nextCursor = response.data.paging?.next?.after;
    }

    outputSuccess(args, {
      command: 'crm.tickets',
      account_id: derivedAccountId,
      data: results,
      total,
      next_cursor: nextCursor || null,
    });

    const tableHeader = ['ID', ...props];
    const tableData = results.map(t => [
      t.id,
      ...props.map(p => t.properties[p] || ''),
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.tickets',
      derivedAccountId,
      'TICKETS_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function ticketsBuilder(yargs: Argv): Argv<CrmTicketsArgs> {
  yargs
    .option('limit', {
      alias: 'l',
      describe: 'Max number of tickets to return',
      type: 'number',
      default: 20,
    })
    .option('properties', {
      alias: 'p',
      describe:
        'Comma-separated list of properties (default: subject,content,hs_pipeline_stage,hs_ticket_priority,createdate)',
      type: 'string',
    })
    .option('stage', {
      alias: 's',
      describe: 'Filter by pipeline stage ID',
      type: 'string',
    })
    .option('priority', {
      describe: 'Filter by priority (HIGH, MEDIUM, LOW)',
      type: 'string',
    })
    .option('pipeline', {
      describe: 'Filter by pipeline ID',
      type: 'string',
    })
    .option('after', {
      describe: 'Filter tickets created >= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('before', {
      describe: 'Filter tickets created <= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm tickets', 'List tickets with default properties'],
    ['$0 crm tickets --priority HIGH', 'High priority tickets'],
    ['$0 crm tickets --after 2026-01-01', 'Tickets created in 2026'],
  ]);

  return yargs as Argv<CrmTicketsArgs>;
}

const builder = makeYargsBuilder<CrmTicketsArgs>(
  ticketsBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmTicketsCommand: YargsCommandModule<unknown, CrmTicketsArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmTicketsCommand;
