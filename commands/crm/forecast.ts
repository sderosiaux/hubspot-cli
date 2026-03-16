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
  exitOk,
  exitError,
} from './_lib/output.js';
import { uiLogger } from '../../lib/ui/logger.js';

const command = 'forecast';
const describe = 'Weighted pipeline forecast';

type ForecastArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    pipeline?: string;
    quarter?: string;
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

type QuarterRange = {
  label: string;
  start: Date;
  end: Date;
};

type PipelineForecast = {
  id: string;
  name: string;
  open_deals: number;
  total_amount: number;
  weighted_amount: number;
  closing_this_quarter: { count: number; amount: number };
  at_risk: { count: number; amount: number };
};

/**
 * Fiscal quarters: Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan
 * Parse "Q1-2026" or auto-detect from a given date.
 */
function resolveQuarter(
  quarterArg: string | undefined,
  now: Date
): QuarterRange {
  if (quarterArg) {
    const m = quarterArg.match(/^Q([1-4])-(\d{4})$/i);
    if (!m)
      throw new Error(
        `Invalid --quarter format: "${quarterArg}". Expected e.g. Q1-2026`
      );
    const q = parseInt(m[1], 10);
    const year = parseInt(m[2], 10);
    return quarterBounds(q, year);
  }
  return detectCurrentQuarter(now);
}

function quarterBounds(q: number, year: number): QuarterRange {
  // Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan(next year)
  const ranges: [number, number, number, number][] = [
    [year, 1, year, 3], // Q1: Feb(1)–Apr(3) — 0-indexed months
    [year, 4, year, 6], // Q2: May(4)–Jul(6)
    [year, 7, year, 9], // Q3: Aug(7)–Oct(9)
    [year, 10, year + 1, 0], // Q4: Nov(10)–Jan(0 next year)
  ];
  const [sy, sm, ey, em] = ranges[q - 1];
  const start = new Date(sy, sm, 1);
  const end = new Date(ey, em + 1, 0, 23, 59, 59, 999); // last day of end month
  return { label: `Q${q}-${year}`, start, end };
}

function detectCurrentQuarter(now: Date): QuarterRange {
  const m = now.getMonth(); // 0-indexed
  const y = now.getFullYear();
  // Q1: Feb(1)-Apr(3), Q2: May(4)-Jul(6), Q3: Aug(7)-Oct(9), Q4: Nov(10)-Jan(0)
  if (m >= 1 && m <= 3) return quarterBounds(1, y);
  if (m >= 4 && m <= 6) return quarterBounds(2, y);
  if (m >= 7 && m <= 9) return quarterBounds(3, y);
  // Nov-Dec: Q4 of this year; Jan: Q4 of previous year
  if (m === 0) return quarterBounds(4, y - 1);
  return quarterBounds(4, y); // Nov or Dec
}

function fmtCurrency(n: number): string {
  if (n === 0) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

async function fetchOpenDeals(accountId: number): Promise<DealRecord[]> {
  const props = [
    'dealname',
    'amount',
    'dealstage',
    'closedate',
    'pipeline',
    'hubspot_owner_id',
    'hs_deal_stage_probability',
    'hs_forecast_amount',
    'hs_is_closed',
    'hs_lastmodifieddate',
  ];

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
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'hs_is_closed',
                    operator: 'EQ',
                    value: 'false',
                  },
                ],
              },
            ],
            properties: props,
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
    process.stderr.write(`\rFetching open deals... ${all.length}`);

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

async function handler(args: ArgumentsCamelCase<ForecastArgs>): Promise<void> {
  const { derivedAccountId, pipeline: pipelineFilter } = args;
  void trackCommandUsage('crm-forecast', {}, derivedAccountId);

  try {
    const now = new Date();
    const quarter = resolveQuarter(args.quarter, now);
    const staleCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. Try to fetch pipeline labels
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

    // 2. Fetch all open deals
    const deals = await fetchOpenDeals(derivedAccountId);

    // 3. Apply pipeline filter
    let filteredDeals = deals;
    if (pipelineFilter) {
      const filterLower = pipelineFilter.toLowerCase();
      filteredDeals = deals.filter(d => {
        const pid = d.properties.pipeline || '';
        const label = (pipelineLabels[pid] || pid).toLowerCase();
        return label.includes(filterLower) || pid === pipelineFilter;
      });
    }

    // 4. Group by pipeline and aggregate
    const pipelineMap = new Map<string, PipelineForecast>();

    for (const deal of filteredDeals) {
      const pid = deal.properties.pipeline || 'unknown';
      if (!pipelineMap.has(pid)) {
        pipelineMap.set(pid, {
          id: pid,
          name: pipelineLabels[pid] || pid,
          open_deals: 0,
          total_amount: 0,
          weighted_amount: 0,
          closing_this_quarter: { count: 0, amount: 0 },
          at_risk: { count: 0, amount: 0 },
        });
      }

      const pf = pipelineMap.get(pid)!;
      const amount = parseFloat(deal.properties.amount || '0') || 0;
      const probability =
        parseFloat(deal.properties.hs_deal_stage_probability || '0') || 0;
      const forecastAmount = deal.properties.hs_forecast_amount
        ? parseFloat(deal.properties.hs_forecast_amount) || null
        : null;
      const weighted =
        forecastAmount !== null ? forecastAmount : amount * (probability / 100);

      const closedate = deal.properties.closedate
        ? new Date(deal.properties.closedate)
        : null;
      const lastModified = deal.properties.hs_lastmodifieddate
        ? new Date(deal.properties.hs_lastmodifieddate)
        : null;

      pf.open_deals++;
      pf.total_amount += amount;
      pf.weighted_amount += weighted;

      if (closedate && closedate >= quarter.start && closedate <= quarter.end) {
        pf.closing_this_quarter.count++;
        pf.closing_this_quarter.amount += amount;
      }

      if (lastModified && lastModified < staleCutoff) {
        pf.at_risk.count++;
        pf.at_risk.amount += amount;
      }
    }

    const pipelines = Array.from(pipelineMap.values()).sort(
      (a, b) => b.total_amount - a.total_amount
    );

    outputSuccess(args, {
      command: 'crm.forecast',
      account_id: derivedAccountId,
      data: {
        quarter: quarter.label,
        pipelines,
      },
      total: filteredDeals.length,
    });

    uiLogger.log(
      `\n${chalk.bold('Pipeline Forecast')} — ${chalk.cyan(quarter.label)} (${filteredDeals.length} open deals)\n`
    );

    for (const pf of pipelines) {
      uiLogger.log(chalk.bold(`Pipeline: ${pf.name}`));
      uiLogger.log(
        `  Open deals:      ${chalk.white(String(pf.open_deals).padStart(4))}  (${fmtCurrency(pf.total_amount)})`
      );
      uiLogger.log(
        `  Weighted:        ${chalk.green(fmtCurrency(pf.weighted_amount))}`
      );
      uiLogger.log(
        `  Closing this Q:  ${chalk.white(String(pf.closing_this_quarter.count).padStart(4))} deals  (${fmtCurrency(pf.closing_this_quarter.amount)})`
      );
      uiLogger.log(
        `  At risk (30d+):  ${chalk.red(String(pf.at_risk.count).padStart(4))} deals  (${fmtCurrency(pf.at_risk.amount)})`
      );
      uiLogger.log('');
    }

    if (pipelines.length === 0) {
      uiLogger.log(chalk.yellow('No open deals found.'));
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.forecast',
      derivedAccountId,
      'FORECAST_FAILED',
      String(err)
    );
    exitError();
  }
}

function forecastBuilder(yargs: Argv): Argv<ForecastArgs> {
  yargs
    .option('pipeline', {
      alias: 'p',
      describe: 'Filter by pipeline ID or name (partial match)',
      type: 'string',
    })
    .option('quarter', {
      alias: 'q',
      describe:
        'Quarter to forecast closes against, e.g. Q1-2026 (default: current fiscal quarter)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm forecast', 'Forecast for current quarter, all pipelines'],
    ['$0 crm forecast -q Q2-2026', 'Forecast against Q2-2026'],
    ['$0 crm forecast -p "new logo" -q Q1-2026', 'New Logo pipeline, Q1-2026'],
    ['$0 crm forecast --json', 'JSON output for scripting'],
  ]);

  return yargs as Argv<ForecastArgs>;
}

const builder = makeYargsBuilder<ForecastArgs>(
  forecastBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmForecastCommand: YargsCommandModule<unknown, ForecastArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmForecastCommand;
