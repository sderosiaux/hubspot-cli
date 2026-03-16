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

async function handler(
  args: ArgumentsCamelCase<CrmTicketsArgs>
): Promise<void> {
  const { derivedAccountId, limit = 20, properties } = args;
  void trackCommandUsage('crm-tickets', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : DEFAULT_PROPERTIES;

  try {
    const response = await http.get<CrmListResponse>(derivedAccountId, {
      url: '/crm/v3/objects/tickets',
      params: {
        limit: String(limit),
        properties: props.join(','),
      },
    });

    const { results, total, paging } = response.data;
    const nextCursor = paging?.next?.after;

    outputSuccess(args, {
      command: 'crm.tickets',
      account_id: derivedAccountId,
      data: results,
      total,
      next_cursor: nextCursor ?? null,
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
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm tickets', 'List tickets with default properties'],
    [
      '$0 crm tickets -l 50 -p "subject,hs_ticket_priority"',
      'List 50 tickets with custom properties',
    ],
    ['$0 crm tickets --json', 'List tickets as JSON'],
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
