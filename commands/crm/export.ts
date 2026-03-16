import { Argv, ArgumentsCamelCase } from 'yargs';
import fs from 'fs';
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

const command = 'export <object-type>';
const describe = 'Export all CRM records of a given type';

type ExportArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    properties?: string;
    format?: string;
    output?: string;
    stage?: string;
    pipeline?: string;
    owner?: string;
    after?: string;
    before?: string;
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

const DEFAULT_PROPS: Record<string, string[]> = {
  contacts: ['firstname', 'lastname', 'email', 'phone', 'company'],
  companies: ['name', 'domain', 'industry', 'city', 'phone'],
  deals: ['dealname', 'dealstage', 'amount', 'closedate', 'pipeline'],
  tickets: ['subject', 'hs_pipeline_stage', 'hs_ticket_priority', 'createdate'],
};

type SearchFilter = {
  propertyName: string;
  operator: string;
  value?: string;
};

type CrmSearchResponse = {
  results: CrmRecord[];
  total: number;
  paging?: { next?: { after?: string } };
};

function buildExportFilters(
  args: ArgumentsCamelCase<ExportArgs>
): SearchFilter[] {
  const filters: SearchFilter[] = [];
  if (args.stage) {
    const raw = args.stage.toLowerCase();
    if (raw === 'won') {
      filters.push({
        propertyName: 'hs_is_closed_won',
        operator: 'EQ',
        value: 'true',
      });
    } else if (raw === 'lost') {
      filters.push({
        propertyName: 'hs_is_closed',
        operator: 'EQ',
        value: 'true',
      });
      filters.push({
        propertyName: 'hs_is_closed_won',
        operator: 'EQ',
        value: 'false',
      });
    } else if (raw === 'open') {
      filters.push({
        propertyName: 'hs_is_closed',
        operator: 'EQ',
        value: 'false',
      });
    } else {
      filters.push({ propertyName: 'dealstage', operator: 'EQ', value: raw });
    }
  }
  if (args.pipeline) {
    filters.push({
      propertyName: 'pipeline',
      operator: 'EQ',
      value: args.pipeline,
    });
  }
  if (args.owner) {
    filters.push({
      propertyName: 'hubspot_owner_id',
      operator: 'EQ',
      value: args.owner,
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

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

async function handler(args: ArgumentsCamelCase<ExportArgs>): Promise<void> {
  const {
    derivedAccountId,
    objectType,
    properties,
    format = 'json',
    output: outFile,
  } = args;
  void trackCommandUsage('crm-export', {}, derivedAccountId);

  const props = properties
    ? properties.split(',').map(p => p.trim())
    : DEFAULT_PROPS[objectType] || ['hs_object_id'];

  const filters = buildExportFilters(args);
  const useSearch = filters.length > 0;

  try {
    const allRecords: CrmRecord[] = [];
    let after: string | undefined;

    let page = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let response: { data: CrmPageResponse | CrmSearchResponse };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (useSearch) {
            response = await http.post<CrmSearchResponse>(derivedAccountId, {
              url: `/crm/v3/objects/${objectType}/search`,
              data: {
                filterGroups: [{ filters }],
                properties: props,
                limit: 100,
                ...(after ? { after } : {}),
              },
            });
          } else {
            const params: Record<string, string> = {
              limit: '100',
              properties: props.join(','),
            };
            if (after) params.after = after;
            response = await http.get<CrmPageResponse>(derivedAccountId, {
              url: `/crm/v3/objects/${objectType}`,
              params,
            });
          }
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

      allRecords.push(...response!.data.results);
      process.stderr.write(`\rExported ${allRecords.length} records...`);

      const cursor = response!.data.paging?.next?.after;
      if (!cursor) break;
      after = cursor;

      // Throttle: pause every 10 pages to stay under rate limits
      page++;
      if (page % 10 === 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    process.stderr.write('\n');

    let content: string;
    if (format === 'csv') {
      const header = ['id', ...props].map(csvEscape).join(',');
      const rows = allRecords.map(r =>
        ['id', ...props]
          .map(p => (p === 'id' ? r.id : r.properties[p] || ''))
          .map(csvEscape)
          .join(',')
      );
      content = [header, ...rows].join('\n') + '\n';
    } else {
      content = JSON.stringify(
        allRecords.map(r => ({ id: r.id, ...r.properties })),
        null,
        2
      );
    }

    if (outFile) {
      fs.writeFileSync(outFile, content, 'utf-8');
      process.stderr.write(
        `Exported ${allRecords.length} ${objectType} to ${outFile}\n`
      );
    }

    outputSuccess(args, {
      command: 'crm.export',
      account_id: derivedAccountId,
      data: outFile
        ? { file: outFile, count: allRecords.length }
        : format === 'csv'
          ? content
          : allRecords.map(r => ({ id: r.id, ...r.properties })),
      total: allRecords.length,
    });

    if (!outFile && !args.json) {
      process.stdout.write(content);
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.export',
      derivedAccountId,
      'EXPORT_FAILED',
      String(err)
    );
    exitError();
  }
}

function exportBuilder(yargs: Argv): Argv<ExportArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets, etc.)',
      type: 'string',
    })
    .option('properties', {
      alias: 'p',
      describe: 'Comma-separated list of properties to export',
      type: 'string',
    })
    .option('format', {
      alias: 'f',
      describe: 'Output format',
      choices: ['json', 'csv'],
      default: 'json',
    })
    .option('output', {
      alias: 'o',
      describe: 'Write to file instead of stdout',
      type: 'string',
    })
    .option('stage', {
      alias: 's',
      describe: 'Filter deals by stage (won, lost, open, or stage ID)',
      type: 'string',
    })
    .option('pipeline', {
      describe: 'Filter by pipeline ID',
      type: 'string',
    })
    .option('owner', {
      describe: 'Filter by owner ID',
      type: 'string',
    })
    .option('after', {
      describe: 'Filter records created >= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('before', {
      describe: 'Filter records created <= date (YYYY-MM-DD)',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON envelope (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm export contacts -o contacts.json', 'Export all contacts to file'],
    ['$0 crm export deals -f csv -o deals.csv', 'Export deals as CSV'],
    [
      '$0 crm export deals -s won --after 2026-01-01 -o won.json',
      'Export won deals in 2026',
    ],
  ]);

  return yargs as Argv<ExportArgs>;
}

const builder = makeYargsBuilder<ExportArgs>(exportBuilder, command, describe, {
  useGlobalOptions: true,
  useConfigOptions: true,
  useAccountOptions: true,
  useEnvironmentOptions: true,
});

const crmExportCommand: YargsCommandModule<unknown, ExportArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmExportCommand;
