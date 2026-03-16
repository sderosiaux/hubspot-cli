import { Argv } from 'yargs';
import appSecretCommand from './app/secret.js';
import { makeYargsBuilder } from '../lib/yargsUtils.js';
import { YargsCommandModuleBucket } from '../types/Yargs.js';
import { commands } from '../lang/en.js';

const command = ['app', 'apps'];
const describe = commands.app.describe;

function appBuilder(yargs: Argv) {
  yargs.command(appSecretCommand).demandCommand(1, '');
  return yargs;
}

const builder = makeYargsBuilder(appBuilder, command, describe);

const appCommand: YargsCommandModuleBucket = {
  command,
  describe,
  builder,
  handler: () => {},
};

export default appCommand;
