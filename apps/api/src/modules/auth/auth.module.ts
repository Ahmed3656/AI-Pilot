import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AUTH_CLOCK, SystemAuthClock } from './auth-clock';
import {
  AUTH_PERSISTENCE,
  InMemoryAuthPersistence,
  TypeormAuthPersistence,
} from './auth-persistence.store';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AUTHENTICATION_GRANT_PORT,
  UnavailableAuthenticationGrantAdapter,
} from './authentication-grant.port';
import { AuthenticationSession } from './entities/authentication-session.entity';
import { IdentityToken } from './entities/identity-token.entity';
import { LoginThrottle } from './entities/login-throttle.entity';
import { PasswordCredential } from './entities/password-credential.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  IDENTITY_NOTIFICATION_PORT,
  UnavailableIdentityNotificationAdapter,
} from './identity-notification.port';
import { Argon2PasswordHasher, PASSWORD_HASHER } from './password-hasher';
import { JwtStrategy } from './strategies/jwt.strategy';

const authEntities = [
  PasswordCredential,
  AuthenticationSession,
  RefreshToken,
  IdentityToken,
  LoginThrottle,
];
const databaseEnabled = process.env.DATABASE_ENABLED === 'true';

const persistenceProvider: Provider = databaseEnabled
  ? {
      provide: AUTH_PERSISTENCE,
      useFactory: (
        dataSource: DataSource,
        users: Repository<User>,
        credentials: Repository<PasswordCredential>,
        identityTokens: Repository<IdentityToken>,
        sessions: Repository<AuthenticationSession>,
        refreshTokens: Repository<RefreshToken>,
        throttles: Repository<LoginThrottle>,
      ) =>
        new TypeormAuthPersistence(
          dataSource,
          users,
          credentials,
          identityTokens,
          sessions,
          refreshTokens,
          throttles,
        ),
      inject: [
        DataSource,
        getRepositoryToken(User),
        getRepositoryToken(PasswordCredential),
        getRepositoryToken(IdentityToken),
        getRepositoryToken(AuthenticationSession),
        getRepositoryToken(RefreshToken),
        getRepositoryToken(LoginThrottle),
      ],
    }
  : { provide: AUTH_PERSISTENCE, useClass: InMemoryAuthPersistence };

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
      }),
    }),
    ...(databaseEnabled ? [TypeOrmModule.forFeature(authEntities)] : []),
  ],
  controllers: [AuthController],
  providers: [
    persistenceProvider,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    {
      provide: IDENTITY_NOTIFICATION_PORT,
      useClass: UnavailableIdentityNotificationAdapter,
    },
    {
      provide: AUTHENTICATION_GRANT_PORT,
      useClass: UnavailableAuthenticationGrantAdapter,
    },
    {
      provide: AUTH_CLOCK,
      useClass: SystemAuthClock,
    },
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    PassportModule,
    JwtAuthGuard,
    AUTH_PERSISTENCE,
  ],
})
export class AuthModule {}
