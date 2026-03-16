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
import { commands } from '../../lang/en.js';
import { makeYargsBuilder } from '../../lib/yargsUtils.js';
import { trackCommandUsage } from '../../lib/usageTracking.js';
import {
  outputSuccess,
  outputError,
  outputTable,
  exitOk,
  exitError,
} from './_lib/output.js';

const command = ['pipelines', 'pipeline'];
const describe = commands.crm.subcommands.pipelines.describe;

type CrmPipelinesArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType?: string;
    json?: boolean;
  };

type PipelineStage = {
  id: string;
  label: string;
  displayOrder: number;
};

type PipelineResult = {
  id: string;
  label: string;
  displayOrder: number;
  stages: PipelineStage[];
};

type PipelinesResponse = {
  results: PipelineResult[];
};

async function handler(
  args: ArgumentsCamelCase<CrmPipelinesArgs>
): Promise<void> {
  const { derivedAccountId, objectType = 'deals' } = args;
  void trackCommandUsage('crm-pipelines', {}, derivedAccountId);

  try {
    const response = await http.get<PipelinesResponse>(derivedAccountId, {
      url: `/crm/v3/pipelines/${objectType}`,
    });

    const { results } = response.data;

    outputSuccess(args, {
      command: 'crm.pipelines',
      account_id: derivedAccountId,
      data: results,
      total: results.length,
    });

    const tableHeader = ['ID', 'Label', 'Order', 'Stages'];
    const tableData = results.map(p => [
      p.id,
      p.label,
      String(p.displayOrder),
      p.stages.map(s => s.label).join(' → '),
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.pipelines',
      derivedAccountId,
      'PIPELINES_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function pipelinesBuilder(yargs: Argv): Argv<CrmPipelinesArgs> {
  yargs
    .option('object-type', {
      alias: 't',
      describe: 'Object type: deals or tickets (default: deals)',
      type: 'string',
      default: 'deals',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm pipelines', 'List deal pipelines'],
    ['$0 crm pipelines -t tickets', 'List ticket pipelines'],
  ]);

  return yargs as Argv<CrmPipelinesArgs>;
}

const builder = makeYargsBuilder<CrmPipelinesArgs>(
  pipelinesBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmPipelinesCommand: YargsCommandModule<unknown, CrmPipelinesArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmPipelinesCommand;
