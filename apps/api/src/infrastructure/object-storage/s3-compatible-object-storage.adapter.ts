import {
  ObjectNotFoundError,
  type ObjectStorageHealthPort,
  type ObjectStoragePort,
  type ObjectStoragePutRequest,
  type StoredObject,
} from './object-storage.port';
import { verifyObject } from './object-verification';

export interface S3CompatibleClient {
  putObject(input: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
    contentLength: number;
    checksumSha256: string;
    serverSideEncryption: 'AES256' | 'aws:kms';
    kmsKeyId?: string;
  }): Promise<void>;
  getObject(input: {
    bucket: string;
    key: string;
  }): Promise<StoredObject | null>;
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  bucketExists(input: { bucket: string }): Promise<boolean>;
}

export class S3CompatibleObjectStorageAdapter
  implements ObjectStoragePort, ObjectStorageHealthPort
{
  constructor(
    private readonly client: S3CompatibleClient,
    private readonly bucket: string,
    private readonly encryption: 'AES256' | 'aws:kms' = 'AES256',
    private readonly kmsKeyId?: string,
  ) {}

  async put(request: ObjectStoragePutRequest): Promise<void> {
    verifyObject(request);
    await this.client.putObject({
      bucket: this.bucket,
      key: this.key(request.tenantId, request.objectName),
      body: request.body,
      contentType: request.mediaType,
      contentLength: request.byteLength,
      checksumSha256: request.sha256,
      serverSideEncryption: this.encryption,
      ...(this.kmsKeyId ? { kmsKeyId: this.kmsKeyId } : {}),
    });
  }

  async get(tenantId: string, objectName: string): Promise<StoredObject> {
    const object = await this.client.getObject({
      bucket: this.bucket,
      key: this.key(tenantId, objectName),
    });
    if (!object) throw new ObjectNotFoundError();
    return object;
  }

  async delete(tenantId: string, objectName: string): Promise<void> {
    await this.client.deleteObject({
      bucket: this.bucket,
      key: this.key(tenantId, objectName),
    });
  }

  async status(): Promise<'up' | 'down'> {
    try {
      return (await this.client.bucketExists({ bucket: this.bucket }))
        ? 'up'
        : 'down';
    } catch {
      return 'down';
    }
  }

  private key(tenantId: string, objectName: string): string {
    return `tenants/${encodeURIComponent(tenantId)}/evidence/${objectName}`;
  }
}
