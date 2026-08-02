import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  ObjectStorageIntegrityError,
  ObjectStorageUnavailableError,
  type StoredObject,
} from './object-storage.port';
import type { S3CompatibleClient } from './s3-compatible-object-storage.adapter';

export interface AwsS3CompatibleClientOptions {
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class AwsS3CompatibleClient implements S3CompatibleClient {
  private readonly client: S3Client;

  constructor(options: AwsS3CompatibleClientOptions, client?: S3Client) {
    this.client =
      client ??
      new S3Client({
        region: options.region,
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
        forcePathStyle: options.forcePathStyle,
      });
  }

  async putObject(
    input: Parameters<S3CompatibleClient['putObject']>[0],
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
          ChecksumSHA256: Buffer.from(input.checksumSha256, 'hex').toString(
            'base64',
          ),
          ServerSideEncryption: input.serverSideEncryption,
          ...(input.kmsKeyId ? { SSEKMSKeyId: input.kmsKeyId } : {}),
        }),
      );
    } catch {
      throw new ObjectStorageUnavailableError();
    }
  }

  async getObject(
    input: Parameters<S3CompatibleClient['getObject']>[0],
  ): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          ChecksumMode: 'ENABLED',
        }),
      );
      if (!response.Body || !response.ContentType)
        throw new ObjectStorageIntegrityError();
      const body = Buffer.from(await response.Body.transformToByteArray());
      const sha256 = createHash('sha256').update(body).digest('hex');
      if (
        response.ContentLength !== undefined &&
        response.ContentLength !== body.byteLength
      ) {
        throw new ObjectStorageIntegrityError();
      }
      if (
        response.ChecksumSHA256 &&
        Buffer.from(response.ChecksumSHA256, 'base64').toString('hex') !==
          sha256
      ) {
        throw new ObjectStorageIntegrityError();
      }
      return {
        body,
        mediaType: response.ContentType,
        byteLength: body.byteLength,
        sha256,
      };
    } catch (error) {
      if (error instanceof ObjectStorageIntegrityError) throw error;
      if (isNotFound(error)) return null;
      throw new ObjectStorageUnavailableError();
    }
  }

  async deleteObject(
    input: Parameters<S3CompatibleClient['deleteObject']>[0],
  ): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
    } catch {
      throw new ObjectStorageUnavailableError();
    }
  }

  async bucketExists(
    input: Parameters<S3CompatibleClient['bucketExists']>[0],
  ): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: input.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}
