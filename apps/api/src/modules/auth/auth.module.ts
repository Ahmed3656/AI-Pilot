import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AUTH_ACCOUNT_STORE,
  InMemoryAuthAccountStore,
  TypeormAuthAccountStore,
} from './auth-account.store';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthAccount } from './entities/auth-account.entity';

const databaseEnabled = process.env.DATABASE_ENABLED === 'true';
const accountStore: Provider = databaseEnabled
  ? {
      provide: AUTH_ACCOUNT_STORE,
      useFactory: (repository: Repository<AuthAccount>) =>
        new TypeormAuthAccountStore(repository),
      inject: [getRepositoryToken(AuthAccount)],
    }
  : { provide: AUTH_ACCOUNT_STORE, useClass: InMemoryAuthAccountStore };

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
      }),
    }),
    ...(databaseEnabled ? [TypeOrmModule.forFeature([AuthAccount])] : []),
  ],
  controllers: [AuthController],
  providers: [accountStore, AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
