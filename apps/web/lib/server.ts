import { readDeployment } from '@aaa/adapters/config';
import { migrate, openDatabase } from '@aaa/adapters/database';

export function appDb() {
  const db = openDatabase(process.env.DB_PATH ?? '/data/application.sqlite');
  migrate(db);
  return db;
}
export function runtimeConfig() { return readDeployment(); }
export function isoNow() { return new Date().toISOString(); }
