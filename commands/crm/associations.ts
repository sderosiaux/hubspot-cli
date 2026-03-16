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
  outputTable,
  exitOk,
  exitError,
} from './_lib/output.js';

const command = 'associations <from-type> <id> <to-type>';
const describe = 'List or manage associations between CRM objects';

type CrmAssociationsArgs = CommonArgs &
  ConfigArgs &
  AccountArgs &
  EnvironmentArgs & {
    fromType: string;
    id: string;
    toType: string;
    associate?: string;
    remove?: string;
    limit?: number;
    json?: boolean;
  };

type AssociationType = {
  associationCategory: string;
  associationTypeId: number;
};

type AssociationResult = {
  toObjectId: string;
  associationTypes: AssociationType[];
};

type AssociationListResponse = {
  results: AssociationResult[];
  paging?: { next?: { after: string } };
};

async function handleList(
  derivedAccountId: number,
  fromType: string,
  id: string,
  toType: string,
  limit: number,
  json: boolean
): Promise<void> {
  const response = await http.get<AssociationListResponse>(derivedAccountId, {
    url: `/crm/v4/objects/${fromType}/${id}/associations/${toType}`,
    params: { limit: String(limit) },
  });

  const { results, paging } = response.data;
  const nextCursor = paging?.next?.after;

  const args = { json };
  outputSuccess(args, {
    command: 'crm.associations',
    account_id: derivedAccountId,
    data: results.map(r => ({
      toObjectId: r.toObjectId,
      associationTypes: r.associationTypes,
    })),
    total: results.length,
    next_cursor: nextCursor ?? null,
  });

  if (!json) {
    if (results.length === 0) {
      uiLogger.log('No associations found.');
    }
  }

  const tableHeader = ['To Object ID', 'Category', 'Type ID'];
  const tableData = results.flatMap(r =>
    r.associationTypes.map(at => [
      r.toObjectId,
      at.associationCategory,
      String(at.associationTypeId),
    ])
  );

  outputTable(args, tableHeader, tableData);
  exitOk();
}

async function handleCreate(
  derivedAccountId: number,
  fromType: string,
  fromId: string,
  toType: string,
  toId: string,
  json: boolean
): Promise<void> {
  await http.put(derivedAccountId, {
    url: `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
    data: {},
  });

  const args = { json };
  outputSuccess(args, {
    command: 'crm.associations.create',
    account_id: derivedAccountId,
    data: { fromType, fromId, toType, toId, created: true },
  });

  if (!json) {
    uiLogger.success(
      `Created association: ${fromType} ${fromId} -> ${toType} ${toId}`
    );
  }

  exitOk();
}

async function handleRemove(
  derivedAccountId: number,
  fromType: string,
  fromId: string,
  toType: string,
  toId: string,
  json: boolean
): Promise<void> {
  await http.delete(derivedAccountId, {
    url: `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}/${toId}`,
  });

  const args = { json };
  outputSuccess(args, {
    command: 'crm.associations.remove',
    account_id: derivedAccountId,
    data: { fromType, fromId, toType, toId, removed: true },
  });

  if (!json) {
    uiLogger.success(
      `Removed association: ${fromType} ${fromId} -> ${toType} ${toId}`
    );
  }

  exitOk();
}

async function handler(
  args: ArgumentsCamelCase<CrmAssociationsArgs>
): Promise<void> {
  const {
    derivedAccountId,
    fromType,
    id,
    toType,
    associate,
    remove,
    limit = 100,
    json = false,
  } = args;
  void trackCommandUsage('crm-associations', {}, derivedAccountId);

  try {
    if (associate) {
      await handleCreate(
        derivedAccountId,
        fromType,
        id,
        toType,
        associate,
        json
      );
    } else if (remove) {
      await handleRemove(derivedAccountId, fromType, id, toType, remove, json);
    } else {
      await handleList(derivedAccountId, fromType, id, toType, limit, json);
    }
  } catch (err) {
    logError(err);
    outputError(
      args,
      'crm.associations',
      derivedAccountId,
      'ASSOCIATIONS_FAILED',
      String(err)
    );
    exitError();
  }
}

function associationsBuilder(yargs: Argv): Argv<CrmAssociationsArgs> {
  yargs
    .positional('from-type', {
      describe: 'Source object type (contacts, companies, deals, etc.)',
      type: 'string',
    })
    .positional('id', {
      describe: 'Source record ID',
      type: 'string',
    })
    .positional('to-type', {
      describe: 'Target object type',
      type: 'string',
    })
    .option('associate', {
      describe: 'Create association to this target object ID',
      type: 'string',
    })
    .option('remove', {
      describe: 'Remove association to this target object ID',
      type: 'string',
    })
    .option('limit', {
      alias: 'l',
      describe: 'Max number of associations to return',
      type: 'number',
      default: 100,
    })
    .option('json', {
      describe: 'Output as JSON (for LLM/scripting)',
      type: 'boolean',
      default: false,
    });

  yargs.example([
    [
      '$0 crm associations contacts 12345 companies',
      'List companies associated with a contact',
    ],
    [
      '$0 crm associations contacts 12345 deals --associate 789',
      'Associate a contact with a deal',
    ],
    [
      '$0 crm associations contacts 12345 deals --remove 789',
      'Remove association between contact and deal',
    ],
    [
      '$0 crm associations contacts 12345 companies --json',
      'List associations as JSON',
    ],
  ]);

  return yargs as Argv<CrmAssociationsArgs>;
}

const builder = makeYargsBuilder<CrmAssociationsArgs>(
  associationsBuilder,
  command,
  describe,
  {
    useGlobalOptions: true,
    useConfigOptions: true,
    useAccountOptions: true,
    useEnvironmentOptions: true,
  }
);

const crmAssociationsCommand: YargsCommandModule<unknown, CrmAssociationsArgs> =
  {
    command,
    describe,
    handler,
    builder,
  };

export default crmAssociationsCommand;
