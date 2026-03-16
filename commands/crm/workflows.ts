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

const command = ['workflows', 'workflow'];
const describe = 'List automation workflows';

type WorkflowsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    limit?: number;
    activeOnly?: boolean;
    json?: boolean;
  };

type Workflow = {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  insertedAt: number;
  updatedAt: number;
  contactListId?: number | null;
};

type WorkflowsResponse = {
  workflows: Workflow[];
};

async function handler(args: ArgumentsCamelCase<WorkflowsArgs>): Promise<void> {
  const { derivedAccountId, limit = 50, activeOnly = false } = args;
  void trackCommandUsage('crm-workflows', {}, derivedAccountId);

  try {
    const response = await http.get<WorkflowsResponse>(derivedAccountId, {
      url: '/automation/v3/workflows',
    });

    let workflows = response.data.workflows;
    workflows.sort((a, b) => b.updatedAt - a.updatedAt);

    if (activeOnly) {
      workflows = workflows.filter(w => w.enabled);
    }

    workflows = workflows.slice(0, limit);

    const data = workflows.map(w => ({
      id: w.id,
      name: w.name,
      type: w.type,
      enabled: w.enabled,
      insertedAt: w.insertedAt,
      updatedAt: w.updatedAt,
    }));

    outputSuccess(args, {
      command: 'crm.workflows',
      account_id: derivedAccountId,
      data,
      total: data.length,
    });

    const tableHeader = ['ID', 'Name', 'Type', 'Status', 'Updated'];
    const tableData = data.map(w => [
      String(w.id),
      w.name,
      w.type,
      w.enabled ? chalk.green('Active') : chalk.gray('Inactive'),
      new Date(w.updatedAt).toISOString().split('T')[0],
    ]);

    outputTable(args, tableHeader, tableData);
    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.workflows',
      derivedAccountId,
      'WORKFLOWS_FETCH_FAILED',
      String(err)
    );
    exitError();
  }
}

function workflowsBuilder(yargs: Argv): Argv<WorkflowsArgs> {
  yargs
    .option('limit', {
      alias: 'l',
      describe: 'Max number of workflows to show',
      type: 'number',
      default: 50,
    })
    .option('active-only', {
      describe: 'Show only active workflows',
      type: 'boolean',
      default: false,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm workflows', 'List all workflows'],
    ['$0 crm workflows --active-only', 'List only active workflows'],
    ['$0 crm workflows --json', 'JSON output'],
  ]);

  return yargs as Argv<WorkflowsArgs>;
}

const builder = makeYargsBuilder<WorkflowsArgs>(
  workflowsBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmWorkflowsCommand: YargsCommandModule<unknown, WorkflowsArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmWorkflowsCommand;
