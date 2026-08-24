import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Mirrors apps/api: the CLI reads the datasource url from here, while the
 * runtime supplies it through the pg driver adapter. Spec 0010 gives this
 * project its own database, so it reads PIPELINE_DATABASE_URL, never the
 * portfolio's DATABASE_URL.
 *
 * The datasource is attached only when the variable is set. `prisma generate`
 * needs no connection, and it runs on every install, including CI and a fresh
 * clone where no database exists yet. Declaring the url unconditionally makes
 * that install fail. Commands that do need a connection, `migrate` and `db`,
 * still fail loudly with the variable missing.
 */
const url = process.env.PIPELINE_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(url ? { datasource: { url } } : {}),
});
