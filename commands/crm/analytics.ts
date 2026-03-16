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

const command = 'analytics';
const describe = 'Deal analytics and pipeline performance summary';

type AnalyticsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    pipeline?: string;
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

type PipelineStats = {
  pipeline: string;
  total: number;
  open: number;
  won: number;
  lost: number;
  openValue: number;
  wonValue: number;
  lostValue: number;
};

function fmtCurrency(n: number): string {
  if (n === 0) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

function winRate(won: number, lost: number): string {
  if (won + lost === 0) return 'N/A';
  return `${Math.round((won / (won + lost)) * 100)}%`;
}

function avgDeal(value: number, count: number): string {
  if (count === 0) return 'N/A';
  return fmtCurrency(value / count);
}

async function fetchAllDeals(accountId: number): Promise<DealRecord[]> {
  const all: DealRecord[] = [];
  let after: string | undefined;
  const props =
    'dealname,dealstage,amount,pipeline,closedate,hs_is_closed_won,hs_is_closed,createdate';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params: Record<string, string> = {
      limit: '100',
      properties: props,
    };
    if (after) params.after = after;

    const resp = await http.get<DealsPageResponse>(accountId, {
      url: '/crm/v3/objects/deals',
      params,
    });

    all.push(...resp.data.results);
    process.stderr.write(`\rFetching deals... ${all.length}`);

    const cursor = resp.data.paging?.next?.after;
    if (!cursor) break;
    after = cursor;
  }
  process.stderr.write('\n');
  return all;
}

async function handler(args: ArgumentsCamelCase<AnalyticsArgs>): Promise<void> {
  const { derivedAccountId, pipeline: pipelineFilter } = args;
  void trackCommandUsage('crm-analytics', {}, derivedAccountId);

  try {
    const deals = await fetchAllDeals(derivedAccountId);

    // Try to fetch pipeline labels, fall back to IDs if 403
    const pipelineLabels: Record<string, string> = {};
    try {
      const pResp = await http.get<{
        results: { id: string; label: string }[];
      }>(derivedAccountId, { url: '/crm/v3/pipelines/deals' });
      for (const p of pResp.data.results) {
        pipelineLabels[p.id] = p.label;
      }
    } catch {
      // Token may lack scope — use IDs as labels
    }

    const statsMap: Record<string, PipelineStats> = {};

    for (const deal of deals) {
      const pId = deal.properties.pipeline || 'unknown';

      if (pipelineFilter) {
        const filter = pipelineFilter.toLowerCase();
        const label = (pipelineLabels[pId] || pId).toLowerCase();
        if (!label.includes(filter) && !pId.includes(filter)) continue;
      }

      if (!statsMap[pId]) {
        statsMap[pId] = {
          pipeline: pipelineLabels[pId] || pId,
          total: 0,
          open: 0,
          won: 0,
          lost: 0,
          openValue: 0,
          wonValue: 0,
          lostValue: 0,
        };
      }

      const amount = parseFloat(deal.properties.amount || '0') || 0;
      const isClosed = deal.properties.hs_is_closed === 'true';
      const isWon = deal.properties.hs_is_closed_won === 'true';
      const stats = statsMap[pId];

      stats.total++;
      if (isWon) {
        stats.won++;
        stats.wonValue += amount;
      } else if (isClosed) {
        stats.lost++;
        stats.lostValue += amount;
      } else {
        stats.open++;
        stats.openValue += amount;
      }
    }

    const pipelineStats = Object.values(statsMap).filter(s => s.total > 0);

    const global: PipelineStats = {
      pipeline: 'TOTAL',
      total: 0,
      open: 0,
      won: 0,
      lost: 0,
      openValue: 0,
      wonValue: 0,
      lostValue: 0,
    };
    for (const s of pipelineStats) {
      global.total += s.total;
      global.open += s.open;
      global.won += s.won;
      global.lost += s.lost;
      global.openValue += s.openValue;
      global.wonValue += s.wonValue;
      global.lostValue += s.lostValue;
    }

    const allStats = [...pipelineStats, global];

    outputSuccess(args, {
      command: 'crm.analytics',
      account_id: derivedAccountId,
      data: { pipelines: pipelineStats, global, totalDeals: deals.length },
      total: deals.length,
    });

    uiLogger.log(
      `\n${chalk.bold('Pipeline Summary')} (${deals.length} total deals)\n`
    );

    const headers = [
      'Pipeline',
      'Total',
      'Open',
      'Won',
      'Lost',
      'Win Rate',
      'Open $',
      'Won $',
      'Avg Deal',
    ];
    const rows = allStats.map(s => [
      s.pipeline === 'TOTAL' ? chalk.bold(s.pipeline) : s.pipeline,
      String(s.total),
      String(s.open),
      chalk.green(String(s.won)),
      chalk.red(String(s.lost)),
      winRate(s.won, s.lost),
      fmtCurrency(s.openValue),
      chalk.green(fmtCurrency(s.wonValue)),
      avgDeal(s.wonValue, s.won),
    ]);

    outputTable(args, headers, rows);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.analytics',
      derivedAccountId,
      'ANALYTICS_FAILED',
      String(err)
    );
    exitError();
  }
}

function analyticsBuilder(yargs: Argv): Argv<AnalyticsArgs> {
  yargs
    .option('pipeline', {
      alias: 'p',
      describe: 'Filter by pipeline name (case-insensitive partial match)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm analytics', 'Show analytics for all pipelines'],
    ['$0 crm analytics -p "new logo"', 'Filter to New Logo pipeline'],
    ['$0 crm analytics --json', 'JSON output for scripting'],
  ]);

  return yargs as Argv<AnalyticsArgs>;
}

const builder = makeYargsBuilder<AnalyticsArgs>(
  analyticsBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmAnalyticsCommand: YargsCommandModule<unknown, AnalyticsArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmAnalyticsCommand;
