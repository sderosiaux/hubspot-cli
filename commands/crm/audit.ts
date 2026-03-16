import { Argv, ArgumentsCamelCase } from 'yargs';
import chalk from 'chalk';
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
import { uiLogger } from '../../lib/ui/logger.js';

const command = 'audit <object-type>';
const describe = 'Data quality report — shows field fill rates for CRM records';

type AuditArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    properties?: string;
    limit?: number;
    meddic?: boolean;
    json?: boolean;
  };

type CrmRecord = {
  id: string;
  properties: Record<string, string | null>;
};

type CrmPageResponse = {
  results: CrmRecord[];
  paging?: { next?: { after?: string } };
};

type PropertyStat = {
  name: string;
  filled: number;
  total: number;
  fill_rate: number;
};

const DEFAULT_PROPS: Record<string, string[]> = {
  contacts: [
    'firstname',
    'lastname',
    'email',
    'phone',
    'company',
    'lifecyclestage',
    'hubspot_owner_id',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'city',
    'hubspot_owner_id',
    'phone',
  ],
  deals: [
    'dealname',
    'amount',
    'dealstage',
    'closedate',
    'hubspot_owner_id',
    'pipeline',
  ],
  tickets: [
    'subject',
    'hs_pipeline_stage',
    'hs_ticket_priority',
    'hubspot_owner_id',
  ],
};

const MEDDIC_PROPS = [
  'pains',
  'champion',
  'use_case',
  'decision_criteria',
  'decision_process',
  'close_plan',
  'competitors',
  'budget',
  'economic_impact_of_pain',
  'number_of_licenses',
  'technical_win',
  'commercial_win',
];

async function fetchSample(
  accountId: number,
  objectType: string,
  props: string[],
  limit: number
): Promise<CrmRecord[]> {
  const all: CrmRecord[] = [];
  let after: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params: Record<string, string> = {
      limit: String(Math.min(100, limit - all.length)),
      properties: props.join(','),
    };
    if (after) params.after = after;

    let response: { data: CrmPageResponse };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await http.get<CrmPageResponse>(accountId, {
          url: `/crm/v3/objects/${objectType}`,
          params,
        });
        break;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 429 && attempt < 2) {
          const wait = (attempt + 1) * 10_000;
          process.stderr.write(`\nRate limited, waiting ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          throw err;
        }
      }
    }
    if (!response!) break;

    all.push(...response!.data.results);
    process.stderr.write(`\rSampling ${objectType}... ${all.length}`);

    if (all.length >= limit) break;

    const cursor = response!.data.paging?.next?.after;
    if (!cursor) break;
    after = cursor;
  }
  process.stderr.write('\n');
  return all;
}

function computeFillRates(
  records: CrmRecord[],
  props: string[]
): PropertyStat[] {
  const total = records.length;
  return props
    .map(name => {
      const filled = records.filter(r => {
        const v = r.properties[name];
        return v !== null && v !== undefined && v !== '';
      }).length;
      return {
        name,
        filled,
        total,
        fill_rate: total > 0 ? Math.round((filled / total) * 100) : 0,
      };
    })
    .sort((a, b) => a.fill_rate - b.fill_rate);
}

function fillRateColor(rate: number): string {
  if (rate >= 80) return chalk.green(`${rate}%`);
  if (rate >= 50) return chalk.yellow(`${rate}%`);
  return chalk.red(`${rate}%`);
}

async function handler(args: ArgumentsCamelCase<AuditArgs>): Promise<void> {
  const {
    derivedAccountId,
    objectType,
    properties,
    limit = 500,
    meddic = false,
  } = args;
  void trackCommandUsage('crm-audit', {}, derivedAccountId);

  let props: string[];
  if (properties) {
    props = properties.split(',').map(p => p.trim());
  } else if (meddic && objectType === 'deals') {
    props = MEDDIC_PROPS;
  } else {
    props = DEFAULT_PROPS[objectType] || ['hs_object_id'];
  }

  try {
    const records = await fetchSample(
      derivedAccountId,
      objectType,
      props,
      limit
    );

    const stats = computeFillRates(records, props);
    const sampleSize = records.length;

    outputSuccess(args, {
      command: 'crm.audit',
      account_id: derivedAccountId,
      data: { sample_size: sampleSize, properties: stats },
      total: sampleSize,
    });

    uiLogger.log(
      `\n${chalk.bold('Data Quality Audit')} — ${objectType} (sampled ${sampleSize} records)\n`
    );

    const headers = ['Property', 'Filled', 'Total', 'Fill Rate'];
    const rows = stats.map(s => [
      s.name,
      String(s.filled),
      String(s.total),
      fillRateColor(s.fill_rate),
    ]);

    outputTable(args, headers, rows);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.audit',
      derivedAccountId,
      'AUDIT_FAILED',
      String(err)
    );
    exitError();
  }
}

function auditBuilder(yargs: Argv): Argv<AuditArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets)',
      type: 'string',
    })
    .option('properties', {
      alias: 'p',
      describe: 'Comma-separated list of properties to audit',
      type: 'string',
    })
    .option('limit', {
      alias: 'l',
      describe: 'Max number of records to sample',
      type: 'number',
      default: 500,
    })
    .option('meddic', {
      describe: 'Check MEDDIC fields (deals only)',
      type: 'boolean',
      default: false,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm audit contacts', 'Audit default contact properties'],
    ['$0 crm audit deals --meddic', 'Check MEDDIC field fill rates on deals'],
    [
      '$0 crm audit companies -p "name,domain,industry" --limit 200',
      'Audit specific company properties on 200 records',
    ],
    ['$0 crm audit contacts --json', 'JSON output for scripting'],
  ]);

  return yargs as Argv<AuditArgs>;
}

const builder = makeYargsBuilder<AuditArgs>(auditBuilder, command, describe, {
  useGlobalOptions: true,
  useConfigOptions: true,
  useAccountOptions: true,
  useEnvironmentOptions: true,
});

const crmAuditCommand: YargsCommandModule<unknown, AuditArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmAuditCommand;
