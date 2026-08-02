import { createHash } from 'node:crypto';
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AwsS3CompatibleClient } from './aws-s3-compatible.client';
import { ObjectStorageUnavailableError } from './object-storage.port';

const options = {
  region: 'us-east-1',
  endpoint: 'http://object-storage.internal:9000',
  accessKeyId: 'synthetic-access-id',
  secretAccessKey: 'synthetic-secret-value',
  forcePathStyle: true,
};

type SendMock = jest.Mock<Promise<unknown>, [unknown]>;

describe('AwsS3CompatibleClient', () => {
  it('maps private encrypted writes to the S3 protocol', async () => {
    const send: SendMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const client = new AwsS3CompatibleClient(options, {
      send,
    } as unknown as S3Client);
    const body = Buffer.from('private evidence');
    const sha256 = createHash('sha256').update(body).digest('hex');

    await client.putObject({
      bucket: 'private-evidence',
      key: 'tenants/tenant-1/evidence/artifact-1',
      body,
      contentType: 'application/json',
      contentLength: body.byteLength,
      checksumSha256: sha256,
      serverSideEncryption: 'aws:kms',
      kmsKeyId: 'synthetic-kms-key',
    });

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'private-evidence',
      Key: 'tenants/tenant-1/evidence/artifact-1',
      ContentType: 'application/json',
      ContentLength: body.byteLength,
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'synthetic-kms-key',
    });
    expect(command.input).not.toHaveProperty('ACL');
  });

  it('verifies downloaded bytes and maps provider absence without durable URLs', async () => {
    const body = Buffer.from('stored evidence');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const send: SendMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({
        Body: {
          transformToByteArray: () => Promise.resolve(Uint8Array.from(body)),
        },
        ContentType: 'text/plain',
        ContentLength: body.byteLength,
        ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      });
    const client = new AwsS3CompatibleClient(options, {
      send,
    } as unknown as S3Client);

    await expect(
      client.getObject({
        bucket: 'private-evidence',
        key: 'tenants/tenant-1/evidence/artifact-1',
      }),
    ).resolves.toEqual({
      body,
      mediaType: 'text/plain',
      byteLength: body.byteLength,
      sha256,
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);

    send.mockRejectedValueOnce({
      name: 'NoSuchKey',
      message: 'provider URL must not escape',
    });
    await expect(
      client.getObject({ bucket: 'private-evidence', key: 'missing' }),
    ).resolves.toBeNull();
  });

  it('uses a non-mutating bucket check and sanitizes provider failures', async () => {
    const send: SendMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const client = new AwsS3CompatibleClient(options, {
      send,
    } as unknown as S3Client);

    await expect(
      client.bucketExists({ bucket: 'private-evidence' }),
    ).resolves.toBe(true);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);

    send.mockRejectedValueOnce(
      new Error('https://synthetic-access-id:synthetic-secret-value@invalid'),
    );
    await expect(
      client.putObject({
        bucket: 'private-evidence',
        key: 'artifact',
        body: Buffer.alloc(0),
        contentType: 'application/octet-stream',
        contentLength: 0,
        checksumSha256: createHash('sha256').digest('hex'),
        serverSideEncryption: 'AES256',
      }),
    ).rejects.toEqual(new ObjectStorageUnavailableError());
  });
});
