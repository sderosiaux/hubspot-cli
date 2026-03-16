import { Argv, ArgumentsCamelCase } from 'yargs';
import { http } from '@hubspot/local-dev-lib/http';
import {
  CommonArgs,
  ConfigArgs,
  AccountArgs,
  EnvironmentArgs,
  YargsCommandModule,
} from '../../types/Yargs.js';
import { uiLogger } from '../../lib/ui/logger.js';
import { logError } from '../../lib/errorHandlers/index.js';
import { makeYargsBuilder } from '../../lib/yargsUtils.js';
import { trackCommandUsage } from '../../lib/usageTracking.js';
import {
  outputSuccess,
  outputError,
  exitOk,
  exitError,
} from './_lib/output.js';

const command = 'delete <object-type> <id>';
const describe = 'Delete (archive) a CRM record';

type CrmDeleteArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    objectType: string;
    id: string;
    json?: boolean;
  };

async function handler(args: ArgumentsCamelCase<CrmDeleteArgs>): Promise<void> {
  const { derivedAccountId, objectType, id, json } = args;
  void trackCommandUsage('crm-delete', {}, derivedAccountId);

  try {
    await http.delete(derivedAccountId, {
      url: `/crm/v3/objects/${objectType}/${id}`,
    });

    outputSuccess(args, {
      command: 'crm.delete',
      account_id: derivedAccountId,
      data: {
        id,
        archived: true,
      },
    });

    if (!json) {
      uiLogger.success(`Archived ${objectType} record ${id}`);
    }

    exitOk();
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.delete',
      derivedAccountId,
      'DELETE_FAILED',
      String(err)
    );
    exitError();
  }
}

function deleteBuilder(yargs: Argv): Argv<CrmDeleteArgs> {
  yargs
    .positional('object-type', {
      describe: 'CRM object type (contacts, companies, deals, tickets, etc.)',
      type: 'string',
    })
    .positional('id', {
      describe: 'Record ID to archive',
      type: 'string',
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    ['$0 crm delete contacts 12345', 'Archive a contact'],
    ['$0 crm delete deals 789 --json', 'Archive a deal with JSON output'],
  ]);

  return yargs as Argv<CrmDeleteArgs>;
}

const builder = makeYargsBuilder<CrmDeleteArgs>(
  deleteBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmDeleteCommand: YargsCommandModule<unknown, CrmDeleteArgs> = {
  command,
  describe,
  handler,
  builder,
};

export default crmDeleteCommand;
