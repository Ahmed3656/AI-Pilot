import {
  ObjectNotFoundError,
  type ObjectStoragePort,
  type ObjectStoragePutRequest,
  type StoredObject,
} from './object-storage.port';
import { verifyObject } from './object-verification';

export class InMemoryObjectStorageAdapter implements ObjectStoragePort {
  private readonly objects = new Map<string, StoredObject>();

  put(request: ObjectStoragePutRequest): Promise<void> {
    verifyObject(request);
    this.objects.set(this.key(request.tenantId, request.objectName), {
      body: Buffer.from(request.body),
      mediaType: request.mediaType,
      byteLength: request.byteLength,
      sha256: request.sha256,
    });
    return Promise.resolve();
  }

  get(tenantId: string, objectName: string): Promise<StoredObject> {
    const object = this.objects.get(this.key(tenantId, objectName));
    if (!object) return Promise.reject(new ObjectNotFoundError());
    return Promise.resolve({ ...object, body: Buffer.from(object.body) });
  }

  delete(tenantId: string, objectName: string): Promise<void> {
    this.objects.delete(this.key(tenantId, objectName));
    return Promise.resolve();
  }

  private key(tenantId: string, objectName: string): string {
    return `${tenantId}\u0000${objectName}`;
  }
}
