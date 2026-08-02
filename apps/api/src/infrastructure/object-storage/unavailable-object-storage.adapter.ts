import {
  ObjectStorageUnavailableError,
  type ObjectStorageHealthPort,
  type ObjectStoragePort,
  type StoredObject,
} from './object-storage.port';

export class UnavailableObjectStorageAdapter
  implements ObjectStoragePort, ObjectStorageHealthPort
{
  put(): Promise<void> {
    return Promise.reject(new ObjectStorageUnavailableError());
  }

  get(): Promise<StoredObject> {
    return Promise.reject(new ObjectStorageUnavailableError());
  }

  delete(): Promise<void> {
    return Promise.reject(new ObjectStorageUnavailableError());
  }

  status(): Promise<'down'> {
    return Promise.resolve('down');
  }
}
