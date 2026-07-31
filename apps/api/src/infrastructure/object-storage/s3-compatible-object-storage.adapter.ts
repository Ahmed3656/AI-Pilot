import {
  ObjectNotFoundError,
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
  }): Promise<void>;
  getObject(input: {
    bucket: string;
    key: string;
  }): Promise<StoredObject | null>;
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
}

export class S3CompatibleObjectStorageAdapter implements ObjectStoragePort {
  constructor(
    private readonly client: S3CompatibleClient,
    private readonly bucket: string,
    private readonly encryption: 'AES256' | 'aws:kms' = 'AES256',
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

  private key(tenantId: string, objectName: string): string {
    return `tenants/${encodeURIComponent(tenantId)}/evidence/${objectName}`;
  }
}
