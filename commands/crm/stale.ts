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

const command = 'stale <object-type>';
const describe = 'Find CRM records with no recent activity';

type StaleArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    days?: number;
    limit?: number;
    properties?: string;
    json?: boolean;
  };

type CrmRecord = {
  id: string;
  properties: Record<string, string | null>;
};

type CrmSearchResponse = {
  results: CrmRecord[];
  total: number;
  paging?: { next?: { after?: string } };
};

type StaleRecord = {
  id: string;
  last_modified: string;
  days_stale: number;
  properties: Record<string, string | null>;
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
    'hs_lastmodifieddate',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'city',
    'hubspot_owner_id',
    'phone',
    'hs_lastmodifieddate',
  ],
  deals: [
    'dealname',
    'amount',
    'dealstage',
    'closedate',
    'hubspot_owner_id',
    'pipeline',
    'hs_lastmodifieddate',
  ],
  tickets: [
    'subject',
    'hs_pipeline_stage',
    'hs_ticket_priority',
    'hubspot_owner_id',
    'hs_lastmodifieddate',
  ],
};

// Key display property per object type for the table summary column
const KEY_PROP: Record<string, string> = {
  contacts: 'email',
  companies: 'name',
  deals: 'dealname',
  tickets: 'subject',
};

function daysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().split('T')[0];
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return -1;
  const ts = Number(dateStr);
  const date = isNaN(ts) ? new Date(dateStr).getTime() : ts;
  return Math.floor((Date.now() - date) / (24 * 60 * 60 * 1000));
}

async function fetchStaleRecords(
  accountId: number,
  objectType: string,
  props: string[],
  thresholdMs: number,
  limit: number
): Promise<{ records: StaleRecord[]; total: number }> {
  const all: CrmRecord[] = [];
  let after: string | undefined;
  let apiTotal = 0;

  const propsWithMod = props.includes('hs_lastmodifieddate')
    ? props
    : [...props, 'hs_lastmodifieddate'];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let response: { data: CrmSearchResponse };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await http.post<CrmSearchResponse>(accountId, {
          url: `/crm/v3/objects/${objectType}/search`,
          data: {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'hs_lastmodifieddate',
                    operator: 'LTE',
                    value: String(thresholdMs),
                  },
                ],
              },
            ],
            properties: propsWithMod,
            sorts: [
              { propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' },
            ],
            limit: Math.min(100, limit - all.length),
            ...(after ? { after } : {}),
          },
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

    apiTotal = response!.data.total;
    all.push(...response!.data.results);
    process.stderr.write(`\rFetching stale ${objectType}... ${all.length}`);

    if (all.length >= limit) break;

    const cursor = response!.data.paging?.next?.after;
    if (!cursor) break;
    after = cursor;
  }
  process.stderr.write('\n');

  const stale: StaleRecord[] = all.map(r => {
    const modStr = r.properties['hs_lastmodifieddate'];
    const days = daysSince(modStr);
    const modMs = modStr
      ? isNaN(Number(modStr))
        ? new Date(modStr).getTime()
        : Number(modStr)
      : 0;
    return {
      id: r.id,
      last_modified: modMs > 0 ? formatDate(modMs) : 'unknown',
      days_stale: days,
      properties: r.properties,
    };
  });

  return { records: stale, total: apiTotal };
}

async function handler(args: ArgumentsCamelCase<StaleArgs>): Promise<void> {
  const {
    derivedAccountId,
    objectType,
    days = 30,
    limit = 20,
    properties,
  } = args;
  void trackCommandUsage('crm-stale', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : DEFAULT_PROPS[objectType] || ['hs_object_id', 'hs_lastmodifieddate'];

  const thresholdMs = daysAgo(days);
  const keyProp = KEY_PROP[objectType] || props[0];

  try {
    const { records, total } = await fetchStaleRecords(
      derivedAccountId,
      objectType,
      props,
      thresholdMs,
      limit
    );

    outputSuccess(args, {
      command: 'crm.stale',
      account_id: derivedAccountId,
      data: records,
      total,
    });

    uiLogger.log(
      `\n${chalk.bold('Stale Records')} — ${objectType} not modified in ${days}+ days` +
        ` (${total} total, showing ${records.length})\n`
    );

    if (records.length === 0) {
      uiLogger.log(
        chalk.green(`No stale ${objectType} found (threshold: ${days} days).`)
      );
      exitOk();
      return;
    }

    const headers = ['ID', keyProp, 'Last Modified', 'Days Stale'];
    const rows = records.map(r => {
      const staleDays = r.days_stale;
      const staleStr =
        staleDays >= 90
          ? chalk.red(String(staleDays))
          : staleDays >= 60
            ? chalk.yellow(String(staleDays))
            : String(staleDays);
      return [r.id, r.properties[keyProp] || '', r.last_modified, staleStr];
    });

    outputTable(args, headers, rows);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.stale',
      derivedAccountId,
      'STALE_FAILED',
      String(err)
    );
    exitError();
  }
}

function staleBuilder(yargs: Argv): Argv<StaleArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets)',
      type: 'string',
    })
    .option('days', {
      describe: 'Inactivity threshold in days',
      type: 'number',
      default: 30,
    })
    .option('limit', {
      alias: 'l',
      describe: 'Max number of stale records to return',
      type: 'number',
      default: 20,
    })
    .option('properties', {
      alias: 'p',
      describe: 'Comma-separated list of additional properties to display',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm stale contacts', 'Contacts not modified in 30+ days'],
    ['$0 crm stale deals --days 60', 'Deals dormant for 60+ days'],
    ['$0 crm stale deals --days 90 --limit 50', 'Top 50 most stale deals'],
    ['$0 crm stale companies --json', 'JSON output for scripting'],
  ]);

  return yargs as Argv<StaleArgs>;
}

const builder = makeYargsBuilder<StaleArgs>(staleBuilder, command, describe, {
  useGlobalOptions: true,
  useConfigOptions: true,
  useAccountOptions: true,
  useEnvironmentOptions: true,
});

const crmStaleCommand: YargsCommandModule<unknown, StaleArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmStaleCommand;
