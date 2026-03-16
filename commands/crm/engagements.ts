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

const command = 'engagements <object-type> <id>';
const describe =
  'List engagements (notes, calls, emails, meetings, tasks) associated with a record';

type CrmEngagementsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    id: string;
    type?: string;
    limit?: number;
    json?: boolean;
  };

type AssociationResult = {
  toObjectId: string;
  associationTypes: {
    associationCategory: string;
    associationTypeId: number;
  }[];
};

type AssociationListResponse = {
  results: AssociationResult[];
};

type EngagementRecord = {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
};

type EngagementListResponse = {
  results: EngagementRecord[];
  total: number;
};

const ENGAGEMENT_TYPES = [
  'notes',
  'calls',
  'emails',
  'meetings',
  'tasks',
] as const;
type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

const ENGAGEMENT_TYPE_MAP: Record<string, EngagementType> = {
  NOTE: 'notes',
  CALL: 'calls',
  EMAIL: 'emails',
  MEETING: 'meetings',
  TASK: 'tasks',
};

const ENGAGEMENT_PROPERTIES: Record<EngagementType, string[]> = {
  notes: ['hs_note_body', 'hs_timestamp'],
  calls: [
    'hs_call_title',
    'hs_call_status',
    'hs_timestamp',
    'hs_call_duration',
  ],
  emails: ['hs_email_subject', 'hs_email_status', 'hs_timestamp'],
  meetings: [
    'hs_meeting_title',
    'hs_meeting_start_time',
    'hs_meeting_end_time',
  ],
  tasks: ['hs_task_subject', 'hs_task_status', 'hs_timestamp'],
};

async function fetchAssociatedIds(
  accountId: number,
  objectType: string,
  objectId: string,
  engagementType: EngagementType,
  limit: number
): Promise<string[]> {
  try {
    const response = await http.get<AssociationListResponse>(accountId, {
      url: `/crm/v4/objects/${objectType}/${objectId}/associations/${engagementType}`,
      params: { limit: String(limit) },
    });
    return response.data.results.map(r => r.toObjectId);
  } catch {
    return [];
  }
}

async function fetchEngagementDetails(
  accountId: number,
  engagementType: EngagementType,
  ids: string[]
): Promise<EngagementRecord[]> {
  if (ids.length === 0) return [];

  try {
    const response = await http.post<EngagementListResponse>(accountId, {
      url: `/crm/v3/objects/${engagementType}/batch/read`,
      data: {
        inputs: ids.map(id => ({ id })),
        properties: ENGAGEMENT_PROPERTIES[engagementType],
      },
    });
    return response.data.results;
  } catch {
    return [];
  }
}

type EngagementWithType = EngagementRecord & { engagementType: EngagementType };

async function handler(
  args: ArgumentsCamelCase<CrmEngagementsArgs>
): Promise<void> {
  const { derivedAccountId, objectType, id, limit = 20 } = args;
  void trackCommandUsage('crm-engagements', {}, derivedAccountId);

  const typeFilter = args.type
    ? ENGAGEMENT_TYPE_MAP[args.type.toUpperCase()]
    : undefined;

  if (args.type && !typeFilter) {
    outputError(
      args,
      'crm.engagements',
      derivedAccountId,
      'INVALID_TYPE',
      `Invalid engagement type "${args.type}". Valid: NOTE, CALL, EMAIL, MEETING, TASK`
    );
    exitError();
  }

  const typesToFetch: EngagementType[] = typeFilter
    ? [typeFilter]
    : [...ENGAGEMENT_TYPES];

  try {
    const allEngagements: EngagementWithType[] = [];

    const results = await Promise.all(
      typesToFetch.map(async engType => {
        const ids = await fetchAssociatedIds(
          derivedAccountId,
          objectType,
          id,
          engType,
          limit
        );
        const records = await fetchEngagementDetails(
          derivedAccountId,
          engType,
          ids
        );
        return records.map(r => ({ ...r, engagementType: engType }));
      })
    );

    for (const group of results) {
      allEngagements.push(...group);
    }

    // Sort by createdAt descending
    allEngagements.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    outputSuccess(args, {
      command: 'crm.engagements',
      account_id: derivedAccountId,
      data: allEngagements.map(e => ({
        id: e.id,
        type: e.engagementType,
        properties: e.properties,
        createdAt: e.createdAt,
      })),
      total: allEngagements.length,
    });

    const tableHeader = ['ID', 'Type', 'Summary', 'Created'];
    const tableData = allEngagements.map(e => {
      const summary = getSummary(e);
      return [e.id, e.engagementType, summary, e.createdAt];
    });

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.engagements',
      derivedAccountId,
      'ENGAGEMENTS_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function getSummary(e: EngagementWithType): string {
  const p = e.properties;
  switch (e.engagementType) {
    case 'notes':
      return (p.hs_note_body || '').slice(0, 80);
    case 'calls':
      return p.hs_call_title || p.hs_call_status || '';
    case 'emails':
      return p.hs_email_subject || '';
    case 'meetings':
      return p.hs_meeting_title || '';
    case 'tasks':
      return p.hs_task_subject || '';
    default:
      return '';
  }
}

function engagementsBuilder(yargs: Argv): Argv<CrmEngagementsArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, etc.)',
      type: 'string',
    })
    .positional('id', {
      describe: 'Record ID',
      type: 'string',
    })
    .option('type', {
      describe: 'Filter by engagement type: NOTE, CALL, EMAIL, MEETING, TASK',
      type: 'string',
    })
    .option('limit', {
      alias: 'l',
      describe: 'Max engagements per type to return',
      type: 'number',
      default: 20,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm engagements contacts 12345', 'List all engagements for a contact'],
    [
      '$0 crm engagements contacts 12345 --type NOTE',
      'List only notes for a contact',
    ],
    [
      '$0 crm engagements deals 789 --json',
      'List engagements for a deal as JSON',
    ],
  ]);

  return yargs as Argv<CrmEngagementsArgs>;
}

const builder = makeYargsBuilder<CrmEngagementsArgs>(
  engagementsBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmEngagementsCommand: YargsCommandModule<unknown, CrmEngagementsArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmEngagementsCommand;
