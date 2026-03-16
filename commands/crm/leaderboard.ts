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

const command = 'leaderboard';
const describe = 'Owner performance ranking by closed deals';

type LeaderboardArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    period?: string;
    pipeline?: string;
    json?: boolean;
  };

type DealRecord = {
  id: string;
  properties: Record<string, string | null>;
};

type DealsSearchResponse = {
  results: DealRecord[];
  total: number;
  paging?: { next?: { after?: string } };
};

type OwnerRecord = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};

type OwnersResponse = {
  results: OwnerRecord[];
  paging?: { next?: { after?: string } };
};

type OwnerStats = {
  id: string;
  name: string;
  deals_won: number;
  deals_lost: number;
  total_won_amount: number;
  avg_deal_size: number;
  win_rate: number;
};

// Fiscal quarters: Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan
function getPeriodDates(period: string): {
  start: Date | null;
  end: Date | null;
} {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed

  if (period === 'all') {
    return { start: null, end: null };
  }

  if (period === 'month') {
    const start = new Date(now.getFullYear(), month, 1);
    const end = new Date(now.getFullYear(), month + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  if (period === 'year') {
    // Fiscal year: Feb to Jan
    // If current month is Jan (0), fiscal year started Feb of previous year
    const fiscalStartYear =
      month === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const start = new Date(fiscalStartYear, 1, 1); // Feb 1
    const end = new Date(fiscalStartYear + 1, 0, 31, 23, 59, 59, 999); // Jan 31 next year
    return { start, end };
  }

  // quarter: fiscal quarters Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan
  // month offsets from Jan (0): Jan=0,Feb=1,Mar=2,Apr=3,May=4,Jun=5,Jul=6,Aug=7,Sep=8,Oct=9,Nov=10,Dec=11
  // Q1: months 1,2,3 (Feb,Mar,Apr)
  // Q2: months 4,5,6 (May,Jun,Jul)
  // Q3: months 7,8,9 (Aug,Sep,Oct)
  // Q4: months 10,11,0 (Nov,Dec,Jan)
  let qStart: Date;
  let qEnd: Date;
  const y = now.getFullYear();

  if (month >= 1 && month <= 3) {
    // Q1: Feb-Apr
    qStart = new Date(y, 1, 1);
    qEnd = new Date(y, 3, 30, 23, 59, 59, 999);
  } else if (month >= 4 && month <= 6) {
    // Q2: May-Jul
    qStart = new Date(y, 4, 1);
    qEnd = new Date(y, 6, 31, 23, 59, 59, 999);
  } else if (month >= 7 && month <= 9) {
    // Q3: Aug-Oct
    qStart = new Date(y, 7, 1);
    qEnd = new Date(y, 9, 31, 23, 59, 59, 999);
  } else {
    // Q4: Nov-Dec of current year or Jan of next year
    if (month === 0) {
      // January — Q4 started Nov of previous year
      qStart = new Date(y - 1, 10, 1);
    } else {
      // Nov or Dec
      qStart = new Date(y, 10, 1);
    }
    qEnd = new Date(month === 0 ? y : y + 1, 0, 31, 23, 59, 59, 999);
  }

  return { start: qStart, end: qEnd };
}

function fmtCurrency(n: number): string {
  if (n === 0) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

async function fetchClosedDeals(
  accountId: number,
  period: string,
  pipelineFilter?: string
): Promise<DealRecord[]> {
  const all: DealRecord[] = [];
  let after: string | undefined;
  const props =
    'dealname,amount,hubspot_owner_id,hs_is_closed_won,hs_is_closed,closedate,pipeline';
  const { start, end } = getPeriodDates(period);

  const filters: { propertyName: string; operator: string; value?: string }[] =
    [{ propertyName: 'hs_is_closed', operator: 'EQ', value: 'true' }];

  if (start) {
    filters.push({
      propertyName: 'closedate',
      operator: 'GTE',
      value: start.valueOf().toString(),
    });
  }
  if (end) {
    filters.push({
      propertyName: 'closedate',
      operator: 'LTE',
      value: end.valueOf().toString(),
    });
  }
  if (pipelineFilter) {
    filters.push({
      propertyName: 'pipeline',
      operator: 'EQ',
      value: pipelineFilter,
    });
  }

  let page = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let response: { data: DealsSearchResponse } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await http.post<DealsSearchResponse>(accountId, {
          url: '/crm/v3/objects/deals/search',
          data: {
            filterGroups: [{ filters }],
            properties: props.split(','),
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
    process.stderr.write(`\rFetching closed deals... ${all.length}`);

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

async function fetchOwners(accountId: number): Promise<Record<string, string>> {
  const ownerMap: Record<string, string> = {};
  let after: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params: Record<string, string> = { limit: '100' };
    if (after) params.after = after;

    const resp = await http.get<OwnersResponse>(accountId, {
      url: '/crm/v3/owners',
      params,
    });

    for (const owner of resp.data.results) {
      const name =
        [owner.firstName, owner.lastName].filter(Boolean).join(' ') ||
        owner.email ||
        owner.id;
      ownerMap[owner.id] = name;
    }

    const cursor = resp.data.paging?.next?.after;
    if (!cursor) break;
    after = cursor;
  }

  return ownerMap;
}

async function handler(
  args: ArgumentsCamelCase<LeaderboardArgs>
): Promise<void> {
  const {
    derivedAccountId,
    period = 'quarter',
    pipeline: pipelineFilter,
  } = args;
  void trackCommandUsage('crm-leaderboard', {}, derivedAccountId);

  try {
    const [deals, ownerMap] = await Promise.all([
      fetchClosedDeals(derivedAccountId, period, pipelineFilter),
      fetchOwners(derivedAccountId),
    ]);

    const statsMap: Record<string, OwnerStats> = {};

    for (const deal of deals) {
      const ownerId = deal.properties.hubspot_owner_id || 'unknown';
      const isWon = deal.properties.hs_is_closed_won === 'true';
      const amount = parseFloat(deal.properties.amount || '0') || 0;

      if (!statsMap[ownerId]) {
        statsMap[ownerId] = {
          id: ownerId,
          name: ownerMap[ownerId] || ownerId,
          deals_won: 0,
          deals_lost: 0,
          total_won_amount: 0,
          avg_deal_size: 0,
          win_rate: 0,
        };
      }

      const s = statsMap[ownerId];
      if (isWon) {
        s.deals_won++;
        s.total_won_amount += amount;
      } else {
        s.deals_lost++;
      }
    }

    // Compute derived fields
    for (const s of Object.values(statsMap)) {
      s.avg_deal_size = s.deals_won > 0 ? s.total_won_amount / s.deals_won : 0;
      const total = s.deals_won + s.deals_lost;
      s.win_rate = total > 0 ? (s.deals_won / total) * 100 : 0;
    }

    const ranked = Object.values(statsMap).sort(
      (a, b) => b.total_won_amount - a.total_won_amount
    );

    outputSuccess(args, {
      command: 'crm.leaderboard',
      account_id: derivedAccountId,
      data: {
        period,
        pipeline: pipelineFilter || null,
        owners: ranked,
      },
      total: ranked.length,
    });

    if (!args.json) {
      uiLogger.log(
        `\n${chalk.bold('Owner Leaderboard')} — period: ${chalk.cyan(period)}${pipelineFilter ? ` | pipeline: ${chalk.cyan(pipelineFilter)}` : ''} (${deals.length} closed deals)\n`
      );

      if (ranked.length === 0) {
        uiLogger.log(chalk.yellow('No closed deals found for this period.'));
      } else {
        const headers = [
          '#',
          'Owner',
          'Won',
          'Lost',
          'Win Rate',
          'Total Won',
          'Avg Deal',
        ];
        const rows = ranked.map((s, i) => [
          String(i + 1),
          s.name,
          chalk.green(String(s.deals_won)),
          chalk.red(String(s.deals_lost)),
          s.deals_won + s.deals_lost > 0 ? `${Math.round(s.win_rate)}%` : 'N/A',
          chalk.green(fmtCurrency(s.total_won_amount)),
          s.deals_won > 0 ? fmtCurrency(s.avg_deal_size) : 'N/A',
        ]);
        outputTable(args, headers, rows);
      }
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.leaderboard',
      derivedAccountId,
      'LEADERBOARD_FAILED',
      String(err)
    );
    exitError();
  }
}

function leaderboardBuilder(yargs: Argv): Argv<LeaderboardArgs> {
  yargs
    .option('period', {
      alias: 'p',
      describe: 'Time period for closed deals',
      choices: ['month', 'quarter', 'year', 'all'],
      default: 'quarter',
    })
    .option('pipeline', {
      describe: 'Filter by pipeline ID',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm leaderboard', 'Show leaderboard for current fiscal quarter'],
    ['$0 crm leaderboard --period month', 'Current calendar month'],
    [
      '$0 crm leaderboard --period year --pipeline abc123',
      'Fiscal year, one pipeline',
    ],
    ['$0 crm leaderboard --json', 'JSON output for scripting'],
  ]);

  return yargs as Argv<LeaderboardArgs>;
}

const builder = makeYargsBuilder<LeaderboardArgs>(
  leaderboardBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmLeaderboardCommand: YargsCommandModule<unknown, LeaderboardArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmLeaderboardCommand;
