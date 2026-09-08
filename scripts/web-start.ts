import { readDeployment } from '@aaa/adapters/config';
import { openDatabase, migrate } from '@aaa/adapters/database';
import { accessSync, constants } from 'node:fs';
readDeployment();
accessSync('/data', constants.R_OK | constants.W_OK);
accessSync('/output', constants.R_OK);
const db = openDatabase('/data/application.sqlite');
try { migrate(db); } finally { db.close(); }
