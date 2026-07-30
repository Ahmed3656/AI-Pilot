export interface ObjectStoragePutRequest {
  tenantId: string;
  objectName: string;
  body: Buffer;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

export interface StoredObject {
  body: Buffer;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

export interface ObjectStoragePort {
  put(request: ObjectStoragePutRequest): Promise<void>;
  get(tenantId: string, objectName: string): Promise<StoredObject>;
  delete(tenantId: string, objectName: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object was not found');
  }
}
