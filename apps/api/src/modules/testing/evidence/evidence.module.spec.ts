import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AwsS3CompatibleClientOptions,
  InMemoryObjectStorageAdapter,
  OBJECT_STORAGE,
  OBJECT_STORAGE_HEALTH,
  S3CompatibleObjectStorageAdapter,
  S3CompatibleClient,
  UnavailableObjectStorageAdapter,
  type ObjectStorageHealthPort,
  type ObjectStoragePort,
} from '../../../infrastructure/object-storage';
import {
  EVIDENCE_ARTIFACT_REPOSITORY,
  InMemoryEvidenceArtifactRepository,
  type EvidenceArtifactRepository,
} from './evidence-artifact.repository';
import {
  configuredObjectStorage,
  TestingEvidenceModule,
} from './evidence.module';
import { EvidenceService } from './evidence.service';

describe('TestingEvidenceModule', () => {
  it('resolves deterministic in-memory metadata and byte storage', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TestingEvidenceModule.register({
          databaseEnabled: false,
          allowInMemoryObjectStorage: true,
          durablePrivateStorageRequired: false,
        }),
      ],
    }).compile();

    expect(moduleRef.get(EvidenceService)).toBeInstanceOf(EvidenceService);
    expect(
      moduleRef.get<EvidenceArtifactRepository>(EVIDENCE_ARTIFACT_REPOSITORY),
    ).toBeInstanceOf(InMemoryEvidenceArtifactRepository);
    expect(moduleRef.get<ObjectStoragePort>(OBJECT_STORAGE)).toBeInstanceOf(
      InMemoryObjectStorageAdapter,
    );
    await expect(
      moduleRef.get<ObjectStorageHealthPort>(OBJECT_STORAGE_HEALTH).status(),
    ).resolves.toBe('up');

    await moduleRef.close();
  });

  it('uses an unavailable adapter for the isolated legacy production profile', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TestingEvidenceModule.register({
          databaseEnabled: false,
          allowInMemoryObjectStorage: false,
          durablePrivateStorageRequired: false,
        }),
      ],
    }).compile();

    expect(moduleRef.get<ObjectStoragePort>(OBJECT_STORAGE)).toBeInstanceOf(
      UnavailableObjectStorageAdapter,
    );
    await expect(
      moduleRef.get<ObjectStorageHealthPort>(OBJECT_STORAGE_HEALTH).status(),
    ).resolves.toBe('down');

    await moduleRef.close();
  });

  it('maps validated private S3 configuration without exposing values', () => {
    let observed: AwsS3CompatibleClientOptions | undefined;
    const client: jest.Mocked<S3CompatibleClient> = {
      putObject: jest.fn(),
      getObject: jest.fn(),
      deleteObject: jest.fn(),
      bucketExists: jest.fn(),
    };
    const storage = configuredObjectStorage(
      new ConfigService({
        objectStorage: {
          provider: 's3',
          bucket: 'private-evidence',
          region: 'us-east-1',
          endpoint: 'http://object-storage.internal:9000',
          accessKeyId: 'synthetic-access-id',
          secretAccessKey: 'synthetic-secret-value',
          forcePathStyle: true,
          publicAccessBlocked: true,
          kmsKeyId: 'synthetic-kms-key',
        },
      }),
      (options) => {
        observed = options;
        return client;
      },
    );

    expect(storage).toBeInstanceOf(S3CompatibleObjectStorageAdapter);
    expect(observed).toEqual({
      region: 'us-east-1',
      endpoint: 'http://object-storage.internal:9000',
      accessKeyId: 'synthetic-access-id',
      secretAccessKey: 'synthetic-secret-value',
      forcePathStyle: true,
    });
  });
});
