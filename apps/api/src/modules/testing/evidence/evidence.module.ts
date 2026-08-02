import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AwsS3CompatibleClient,
  AwsS3CompatibleClientOptions,
  InMemoryObjectStorageAdapter,
  OBJECT_STORAGE,
  OBJECT_STORAGE_HEALTH,
  ObjectStoragePort,
  S3CompatibleObjectStorageAdapter,
  S3CompatibleClient,
  UnavailableObjectStorageAdapter,
} from '../../../infrastructure/object-storage';
import { TestingEvidenceArtifact } from './evidence-artifact.entity';
import {
  EVIDENCE_ARTIFACT_REPOSITORY,
  EvidenceArtifactRepository,
  InMemoryEvidenceArtifactRepository,
  TypeormEvidenceArtifactRepository,
} from './evidence-artifact.repository';
import { EvidenceService } from './evidence.service';

export interface TestingEvidenceModuleOptions {
  databaseEnabled: boolean;
  allowInMemoryObjectStorage: boolean;
  durablePrivateStorageRequired: boolean;
  objectStorageProvider?: Provider;
}

@Module({})
export class TestingEvidenceModule {
  static register(options: TestingEvidenceModuleOptions): DynamicModule {
    const metadataProvider: Provider = options.databaseEnabled
      ? {
          provide: EVIDENCE_ARTIFACT_REPOSITORY,
          useClass: TypeormEvidenceArtifactRepository,
        }
      : {
          provide: EVIDENCE_ARTIFACT_REPOSITORY,
          useClass: InMemoryEvidenceArtifactRepository,
        };
    const objectStorageProvider = this.objectStorageProvider(options);

    return {
      module: TestingEvidenceModule,
      imports: options.databaseEnabled
        ? [TypeOrmModule.forFeature([TestingEvidenceArtifact])]
        : [],
      providers: [
        metadataProvider,
        objectStorageProvider,
        { provide: OBJECT_STORAGE_HEALTH, useExisting: OBJECT_STORAGE },
        {
          provide: EvidenceService,
          useFactory: (
            repository: EvidenceArtifactRepository,
            storage: ObjectStoragePort,
          ) => new EvidenceService(repository, storage),
          inject: [EVIDENCE_ARTIFACT_REPOSITORY, OBJECT_STORAGE],
        },
      ],
      exports: [
        EVIDENCE_ARTIFACT_REPOSITORY,
        OBJECT_STORAGE,
        OBJECT_STORAGE_HEALTH,
        EvidenceService,
      ],
    };
  }

  private static objectStorageProvider(
    options: TestingEvidenceModuleOptions,
  ): Provider {
    if (options.allowInMemoryObjectStorage) {
      return {
        provide: OBJECT_STORAGE,
        useClass: InMemoryObjectStorageAdapter,
      };
    }
    if (!options.durablePrivateStorageRequired) {
      return {
        provide: OBJECT_STORAGE,
        useClass: UnavailableObjectStorageAdapter,
      };
    }
    if (options.objectStorageProvider) return options.objectStorageProvider;
    return {
      provide: OBJECT_STORAGE,
      inject: [ConfigService],
      useFactory: configuredObjectStorage,
    };
  }
}

export function configuredObjectStorage(
  config: ConfigService,
  clientFactory: (
    options: AwsS3CompatibleClientOptions,
  ) => S3CompatibleClient = (options) => new AwsS3CompatibleClient(options),
): S3CompatibleObjectStorageAdapter {
  if (
    config.getOrThrow<string>('objectStorage.provider') !== 's3' ||
    !config.getOrThrow<boolean>('objectStorage.publicAccessBlocked')
  ) {
    throw new Error('Private S3-compatible object storage is required');
  }
  const kmsKeyId = config.get<string>('objectStorage.kmsKeyId');
  const client = clientFactory({
    region: config.getOrThrow<string>('objectStorage.region'),
    endpoint: config.get<string>('objectStorage.endpoint'),
    accessKeyId: config.getOrThrow<string>('objectStorage.accessKeyId'),
    secretAccessKey: config.getOrThrow<string>('objectStorage.secretAccessKey'),
    forcePathStyle: config.get<boolean>('objectStorage.forcePathStyle', false),
  });
  return new S3CompatibleObjectStorageAdapter(
    client,
    config.getOrThrow<string>('objectStorage.bucket'),
    kmsKeyId ? 'aws:kms' : 'AES256',
    kmsKeyId,
  );
}
