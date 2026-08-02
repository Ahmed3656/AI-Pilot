import 'dotenv/config';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { PLATFORM_MIGRATIONS } from './migration-manifest';

export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ??
    'postgresql://agent:agent@localhost:5432/agent_platform',
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [...PLATFORM_MIGRATIONS],
  synchronize: false,
});
