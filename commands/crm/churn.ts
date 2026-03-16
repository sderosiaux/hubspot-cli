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

const command = 'churn';
const describe =
  'Churn risk signals — companies and deals with risk indicators';

type ChurnArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    days?: number;
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

type CrmSearchResponse = {
  results: CrmRecord[];
  total: number;
  paging?: { next?: { after?: string } };
};

type OwnersResponse = {
  results: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  }[];
  paging?: { next?: { after?: string } };
};

type RiskCompany = {
  id: string;
  name: string;
  domain: string;
  account_risk: string;
  account_risk_detail: string;
  owner: string;
  last_modified: string;
  days_since_modified: number;
};

type RiskDeal = {
  id: string;
  dealname: string;
  amount: string;
  dealstage: string;
  account_risk: string;
  account_risk_detail: string;
  owner: string;
  last_modified: string;
};

const RISK_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function riskRank(risk: string): number {
  return RISK_ORDER[risk.toLowerCase()] ?? 3;
}

function riskColor(risk: string): string {
  const r = risk.toLowerCase();
  if (r === 'high') return chalk.red(risk);
  if (r === 'medium') return chalk.yellow(risk);
  return chalk.green(risk);
}

function fmtCurrency(n: number): string {
  if (n === 0) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return -1;
  const ms = Date.now() - new Date(dateStr).valueOf();
  return Math.floor(ms / 86_400_000);
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

async function fetchAtRiskCompanies(
  accountId: number,
  days: number
): Promise<CrmRecord[]> {
  const all: CrmRecord[] = [];
  let after: string | undefined;
  const props =
    'name,domain,account_risk,account_risk_detail,hubspot_owner_id,hs_lastmodifieddate,lifecyclestage,cs_comments,conduktor_deployment';

  let page = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let response: { data: CrmPageResponse } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const params: Record<string, string> = {
          limit: '100',
          properties: props,
        };
        if (after) params.after = after;

        response = await http.get<CrmPageResponse>(accountId, {
          url: '/crm/v3/objects/companies',
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
    if (!response) break;

    // Filter locally: keep companies with account_risk set, or with no recent activity
    for (const record of response.data.results) {
      const risk = record.properties.account_risk;
      const lastMod = record.properties.hs_lastmodifieddate;
      const age = daysSince(lastMod);

      const hasRisk = risk && risk.trim() !== '';
      const isStale = age >= 0 && age >= days;

      if (hasRisk || isStale) {
        all.push(record);
      }
    }

    process.stderr.write(`\rScanning companies... ${all.length} flagged`);

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

async function fetchAtRiskDeals(accountId: number): Promise<CrmRecord[]> {
  const all: CrmRecord[] = [];
  let after: string | undefined;
  const props =
    'dealname,amount,dealstage,account_risk,account_risk_detail,hubspot_owner_id,hs_lastmodifieddate';

  const filters = [
    { propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' },
    { propertyName: 'account_risk', operator: 'HAS_PROPERTY' },
  ];

  let page = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let response: { data: CrmSearchResponse } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await http.post<CrmSearchResponse>(accountId, {
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
    process.stderr.write(`\rFetching at-risk deals... ${all.length}`);

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

async function handler(args: ArgumentsCamelCase<ChurnArgs>): Promise<void> {
  const { derivedAccountId, days = 90 } = args;
  void trackCommandUsage('crm-churn', {}, derivedAccountId);

  try {
    const [rawCompanies, rawDeals, ownerMap] = await Promise.all([
      fetchAtRiskCompanies(derivedAccountId, days),
      fetchAtRiskDeals(derivedAccountId),
      fetchOwners(derivedAccountId),
    ]);

    // Build company risk objects, sort: by risk level then oldest first
    const companies: RiskCompany[] = rawCompanies
      .map(c => ({
        id: c.id,
        name: c.properties.name || c.id,
        domain: c.properties.domain || '',
        account_risk: c.properties.account_risk || '',
        account_risk_detail: c.properties.account_risk_detail || '',
        owner:
          ownerMap[c.properties.hubspot_owner_id || ''] ||
          c.properties.hubspot_owner_id ||
          '',
        last_modified: c.properties.hs_lastmodifieddate
          ? new Date(c.properties.hs_lastmodifieddate)
              .toISOString()
              .slice(0, 10)
          : '',
        days_since_modified: daysSince(c.properties.hs_lastmodifieddate),
      }))
      .sort((a, b) => {
        const rDiff = riskRank(a.account_risk) - riskRank(b.account_risk);
        if (rDiff !== 0) return rDiff;
        // Oldest first within same risk level
        return b.days_since_modified - a.days_since_modified;
      });

    // Build deal risk objects
    const deals: RiskDeal[] = rawDeals
      .map(d => {
        const amount = parseFloat(d.properties.amount || '0') || 0;
        return {
          id: d.id,
          dealname: d.properties.dealname || d.id,
          amount: fmtCurrency(amount),
          dealstage: d.properties.dealstage || '',
          account_risk: d.properties.account_risk || '',
          account_risk_detail: d.properties.account_risk_detail || '',
          owner:
            ownerMap[d.properties.hubspot_owner_id || ''] ||
            d.properties.hubspot_owner_id ||
            '',
          last_modified: d.properties.hs_lastmodifieddate
            ? new Date(d.properties.hs_lastmodifieddate)
                .toISOString()
                .slice(0, 10)
            : '',
        };
      })
      .sort((a, b) => riskRank(a.account_risk) - riskRank(b.account_risk));

    outputSuccess(args, {
      command: 'crm.churn',
      account_id: derivedAccountId,
      data: { companies, deals },
      total: companies.length,
    });

    if (!args.json) {
      uiLogger.log(
        `\n${chalk.bold('Churn Risk — Companies')} (look-back: ${chalk.cyan(String(days))} days)\n`
      );

      if (companies.length === 0) {
        uiLogger.log(chalk.green('No at-risk companies found.'));
      } else {
        const companyHeaders = [
          'Company',
          'Risk',
          'Detail',
          'Owner',
          'Last Modified',
          'Days',
        ];
        const companyRows = companies.map(c => [
          c.name,
          c.account_risk ? riskColor(c.account_risk) : chalk.dim('—'),
          c.account_risk_detail
            ? c.account_risk_detail.length > 25
              ? c.account_risk_detail.slice(0, 22) + '...'
              : c.account_risk_detail
            : chalk.dim('—'),
          c.owner || chalk.dim('unassigned'),
          c.last_modified || chalk.dim('—'),
          c.days_since_modified >= 0
            ? String(c.days_since_modified)
            : chalk.dim('—'),
        ]);
        outputTable(args, companyHeaders, companyRows);
      }

      uiLogger.log(`\n${chalk.bold('Churn Risk — Open Deals')}\n`);

      if (deals.length === 0) {
        uiLogger.log(chalk.green('No at-risk open deals found.'));
      } else {
        const dealHeaders = ['Deal', 'Amount', 'Stage', 'Risk', 'Owner'];
        const dealRows = deals.map(d => [
          d.dealname.length > 25 ? d.dealname.slice(0, 22) + '...' : d.dealname,
          d.amount,
          d.dealstage,
          d.account_risk ? riskColor(d.account_risk) : chalk.dim('—'),
          d.owner || chalk.dim('unassigned'),
        ]);
        outputTable(args, dealHeaders, dealRows);
      }
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.churn',
      derivedAccountId,
      'CHURN_FAILED',
      String(err)
    );
    exitError();
  }
}

function churnBuilder(yargs: Argv): Argv<ChurnArgs> {
  yargs
    .option('days', {
      alias: 'd',
      describe: 'Look-back window in days for inactivity detection',
      type: 'number',
      default: 90,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm churn', 'Show churn risk signals (90-day window)'],
    ['$0 crm churn --days 60', 'Use 60-day inactivity threshold'],
    ['$0 crm churn --json', 'JSON output for scripting'],
  ]);

  return yargs as Argv<ChurnArgs>;
}

const builder = makeYargsBuilder<ChurnArgs>(churnBuilder, command, describe, {
  useGlobalOptions: true,
  useConfigOptions: true,
  useAccountOptions: true,
  useEnvironmentOptions: true,
});

const crmChurnCommand: YargsCommandModule<unknown, ChurnArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmChurnCommand;
