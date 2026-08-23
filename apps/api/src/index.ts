import { buildApp } from './app';
import { createDb } from './db/client';
import { migrate } from './db/migrate';

const url = process.env.DATABASE_URL ?? 'postgres://acl:acl@localhost:5432/acl';
const port = Number(process.env.PORT ?? 8000);

await migrate(url);
const db = createDb(url);
const app = buildApp(db);

await app.listen({ host: '0.0.0.0', port });
console.log(`Agent Credit Lab API listening on :${port}`);
