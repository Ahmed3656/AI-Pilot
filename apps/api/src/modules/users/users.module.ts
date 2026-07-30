import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';

const databaseEnabled = process.env.DATABASE_ENABLED === 'true';

@Module({
  imports: databaseEnabled ? [TypeOrmModule.forFeature([User])] : [],
  exports: databaseEnabled ? [TypeOrmModule] : [],
})
export class UsersModule {}
