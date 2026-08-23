import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export function createDb(url: string): Database {
  const pool = new Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
}
