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

const command = 'velocity';
const describe = 'Deal stage velocity analysis — avg time spent in each stage';

type VelocityArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    pipeline?: string;
    after?: string;
    before?: string;
    includeLost?: boolean;
    json?: boolean;
  };

type DealRecord = {
  id: string;
  properties: Record<string, string | null>;
};

type DealsPageResponse = {
  results: DealRecord[];
  paging?: { next?: { after?: string } };
};

type PropertyDef = {
  name: string;
  label: string;
};

type PropertiesResponse = {
  results: PropertyDef[];
};

type StageStats = {
  name: string;
  totalDays: number;
  days: number[];
  dealCount: number;
};

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmtDays(n: number): string {
  return n.toFixed(1);
}

/** Extract stage label from hs_v2_date_entered_* property label.
 *  Label pattern: `Date entered "1. Discovery (New Logo)"` */
function extractStageName(label: string): string {
  const m = label.match(/Date entered "(.+)"/);
  return m ? m[1] : label;
}

async function fetchDateEnteredProps(
  accountId: number
): Promise<{ name: string; stageName: string }[]> {
  const resp = await http.get<PropertiesResponse>(accountId, {
    url: '/crm/v3/properties/deals',
  });
  return resp.data.results
    .filter(
      p =>
        p.name.startsWith('hs_v2_date_entered_') &&
        !p.name.includes('cumulative_time')
    )
    .map(p => ({ name: p.name, stageName: extractStageName(p.label) }));
}

async function fetchAllDeals(
  accountId: number,
  dateEnteredProps: string[],
  args: ArgumentsCamelCase<VelocityArgs>
): Promise<DealRecord[]> {
  const baseProps = [
    'dealname',
    'dealstage',
    'pipeline',
    'createdate',
    'closedate',
    'hs_is_closed_won',
    'hs_is_closed',
  ];
  const allProps = [...baseProps, ...dateEnteredProps].join(',');

  const filters: { propertyName: string; operator: string; value: string }[] =
    [];

  if (!args.includeLost) {
    filters.push({
      propertyName: 'hs_is_closed_won',
      operator: 'EQ',
      value: 'true',
    });
  } else {
    filters.push({
      propertyName: 'hs_is_closed',
      operator: 'EQ',
      value: 'true',
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

  const all: DealRecord[] = [];
  let after: string | undefined;
  let page = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let response!: { data: DealsPageResponse };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await http.post<DealsPageResponse>(accountId, {
          url: '/crm/v3/objects/deals/search',
          data: {
            filterGroups: [{ filters }],
            properties: allProps.split(','),
            limit: 100,
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
    if (!response) break;

    all.push(...response.data.results);
    process.stderr.write(`\rFetching deals... ${all.length}`);

    const cursor = response.data.paging?.next?.after;
    if (!cursor) break;
    after = cursor;

    page++;
    if (page % 10 === 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  process.stderr.write('\n');
  return all;
}

async function handler(args: ArgumentsCamelCase<VelocityArgs>): Promise<void> {
  const { derivedAccountId, pipeline: pipelineFilter } = args;
  void trackCommandUsage('crm-velocity', {}, derivedAccountId);

  try {
    // 1. Fetch hs_v2_date_entered_* property definitions
    process.stderr.write('Fetching deal stage properties...\n');
    const dateEnteredDefs = await fetchDateEnteredProps(derivedAccountId);
    const dateEnteredPropNames = dateEnteredDefs.map(d => d.name);
    const propNameToStage = new Map(
      dateEnteredDefs.map(d => [d.name, d.stageName])
    );

    // 2. Try to fetch pipeline labels
    const pipelineLabels: Record<string, string> = {};
    let filteredPipelineId: string | undefined;
    try {
      const pResp = await http.get<{
        results: { id: string; label: string }[];
      }>(derivedAccountId, { url: '/crm/v3/pipelines/deals' });
      for (const p of pResp.data.results) {
        pipelineLabels[p.id] = p.label;
        if (
          pipelineFilter &&
          (p.label.toLowerCase().includes(pipelineFilter.toLowerCase()) ||
            p.id === pipelineFilter)
        ) {
          filteredPipelineId = p.id;
        }
      }
    } catch {
      // Token may lack scope — use IDs
      if (pipelineFilter) filteredPipelineId = pipelineFilter;
    }

    // 3. Fetch all matching deals
    const deals = await fetchAllDeals(
      derivedAccountId,
      dateEnteredPropNames,
      args
    );

    // 4. Filter by pipeline if requested
    const filteredDeals = filteredPipelineId
      ? deals.filter(d => d.properties.pipeline === filteredPipelineId)
      : deals;

    // 5. Compute stage velocity
    const stageMap = new Map<string, StageStats>();

    for (const deal of filteredDeals) {
      // Collect all date_entered timestamps for this deal
      const entries: { propName: string; stageName: string; ts: number }[] = [];
      for (const propName of dateEnteredPropNames) {
        const raw = deal.properties[propName];
        if (!raw) continue;
        const ts = new Date(raw).getTime();
        if (isNaN(ts)) continue;
        const stageName = propNameToStage.get(propName) ?? propName;
        entries.push({ propName, stageName, ts });
      }

      // Sort by timestamp to reconstruct journey
      entries.sort((a, b) => a.ts - b.ts);

      // Compute time in each stage = next_stage_ts - this_stage_ts
      for (let i = 0; i < entries.length; i++) {
        const curr = entries[i];
        const next = entries[i + 1];
        if (!next) continue; // last stage: can't compute exit time

        const daysInStage = (next.ts - curr.ts) / (1000 * 60 * 60 * 24);
        if (daysInStage < 0) continue; // skip data anomalies

        if (!stageMap.has(curr.stageName)) {
          stageMap.set(curr.stageName, {
            name: curr.stageName,
            totalDays: 0,
            days: [],
            dealCount: 0,
          });
        }
        const s = stageMap.get(curr.stageName)!;
        s.totalDays += daysInStage;
        s.days.push(daysInStage);
        s.dealCount++;
      }
    }

    // 6. Build sorted stage list (sort by first appearance across deals)
    const stageOrder = new Map<string, number>();
    for (const deal of filteredDeals) {
      const entries: { stageName: string; ts: number }[] = [];
      for (const propName of dateEnteredPropNames) {
        const raw = deal.properties[propName];
        if (!raw) continue;
        const ts = new Date(raw).getTime();
        if (isNaN(ts)) continue;
        entries.push({
          stageName: propNameToStage.get(propName) ?? propName,
          ts,
        });
      }
      entries.sort((a, b) => a.ts - b.ts);
      entries.forEach((e, idx) => {
        if (!stageOrder.has(e.stageName)) stageOrder.set(e.stageName, idx);
      });
    }

    const stages = Array.from(stageMap.values()).sort((a, b) => {
      const oa = stageOrder.get(a.name) ?? 999;
      const ob = stageOrder.get(b.name) ?? 999;
      return oa - ob;
    });

    // 7. Compute aggregates
    const stageResults = stages.map(s => {
      const sorted = [...s.days].sort((a, b) => a - b);
      const avg = s.totalDays / s.dealCount;
      const med = median(sorted);
      const min = sorted[0] ?? 0;
      const max = sorted[sorted.length - 1] ?? 0;
      return {
        name: s.name,
        avg_days: avg,
        median_days: med,
        min_days: min,
        max_days: max,
        deal_count: s.dealCount,
      };
    });

    const pipelineName = filteredPipelineId
      ? (pipelineLabels[filteredPipelineId] ?? filteredPipelineId)
      : 'all pipelines';

    outputSuccess(args, {
      command: 'crm.velocity',
      account_id: derivedAccountId,
      data: {
        pipeline: pipelineName,
        stages: stageResults,
        include_lost: args.includeLost ?? false,
      },
      total: filteredDeals.length,
    });

    uiLogger.log(
      `\n${chalk.bold('Stage Velocity')} — ${pipelineName} (${filteredDeals.length} deals, closed-won${args.includeLost ? ' + lost' : ' only'})\n`
    );

    const headers = ['Stage', 'Avg Days', 'Median', 'Min', 'Max', 'Deals'];
    const rows = stageResults.map(s => [
      s.name,
      chalk.yellow(fmtDays(s.avg_days)),
      fmtDays(s.median_days),
      fmtDays(s.min_days),
      fmtDays(s.max_days),
      String(s.deal_count),
    ]);

    if (rows.length === 0) {
      uiLogger.log(
        chalk.yellow('No stage transition data found for the selected deals.')
      );
    } else {
      outputTable(args, headers, rows);
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.velocity',
      derivedAccountId,
      'VELOCITY_FAILED',
      String(err)
    );
    exitError();
  }
}

function velocityBuilder(yargs: Argv): Argv<VelocityArgs> {
  yargs
    .option('pipeline', {
      alias: 'p',
      describe: 'Filter by pipeline ID or name (partial match)',
      type: 'string',
    })
    .option('after', {
      describe: 'Only include deals created >= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('before', {
      describe: 'Only include deals created <= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('include-lost', {
      describe: 'Include closed-lost deals in addition to closed-won',
      type: 'boolean',
      default: false,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm velocity', 'Show velocity for all closed-won deals'],
    ['$0 crm velocity -p "new logo"', 'Filter to New Logo pipeline'],
    [
      '$0 crm velocity --after 2025-01-01 --include-lost',
      'Include lost deals since 2025',
    ],
    ['$0 crm velocity --json', 'JSON output for scripting'],
  ]);

  return yargs as Argv<VelocityArgs>;
}

const builder = makeYargsBuilder<VelocityArgs>(
  velocityBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmVelocityCommand: YargsCommandModule<unknown, VelocityArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmVelocityCommand;
