import { Argv } from 'yargs';
import contactsCommand from './crm/contacts.js';
import companiesCommand from './crm/companies.js';
import dealsCommand from './crm/deals.js';
import ownersCommand from './crm/owners.js';
import pipelinesCommand from './crm/pipelines.js';
import searchCommand from './crm/search.js';
import getCommand from './crm/get.js';
import createCommand from './crm/create.js';
import updateCommand from './crm/update.js';
import deleteCommand from './crm/delete.js';
import ticketsCommand from './crm/tickets.js';
import associationsCommand from './crm/associations.js';
import propertiesCommand from './crm/properties.js';
import schemaCommand from './crm/schema.js';
import engagementsCommand from './crm/engagements.js';
import listsCommand from './crm/lists.js';
import batchCommand from './crm/batch.js';
import exportCommand from './crm/export.js';
import formsCommand from './crm/forms.js';
import workflowsCommand from './crm/workflows.js';
import analyticsCommand from './crm/analytics.js';
import { commands } from '../lang/en.js';
import { YargsCommandModuleBucket } from '../types/Yargs.js';
import { makeYargsBuilder } from '../lib/yargsUtils.js';

export const command = 'crm';
export const describe = commands.crm.describe;

function crmBuilder(yargs: Argv): Argv {
  yargs
    // CRUD
    .command(getCommand)
    .command(createCommand)
    .command(updateCommand)
    .command(deleteCommand)
    // List by type
    .command(contactsCommand)
    .command(companiesCommand)
    .command(dealsCommand)
    .command(ticketsCommand)
    .command(ownersCommand)
    // Search
    .command(searchCommand)
    // Schema & properties
    .command(propertiesCommand)
    .command(schemaCommand)
    // Relationships
    .command(associationsCommand)
    .command(engagementsCommand)
    // Pipelines & lists
    .command(pipelinesCommand)
    .command(listsCommand)
    // Batch & export
    .command(batchCommand)
    .command(exportCommand)
    // Marketing & automation
    .command(formsCommand)
    .command(workflowsCommand)
    // Analytics
    .command(analyticsCommand)
    .demandCommand(1, '');

  return yargs;
}

const builder = makeYargsBuilder(crmBuilder, command, describe);

const crmCommand: YargsCommandModuleBucket = {
  command,
  describe,
  builder,
  handler: () => {},
};

export default crmCommand;
