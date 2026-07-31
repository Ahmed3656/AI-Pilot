import { createHash } from 'node:crypto';
import type { ObjectStoragePutRequest } from './object-storage.port';

export function verifyObject(request: ObjectStoragePutRequest): void {
  // Verify at the storage trust boundary; callers cannot make metadata authoritative.
  if (request.body.byteLength !== request.byteLength)
    throw new Error('Object byte length does not match the uploaded bytes');
  const sha256 = createHash('sha256').update(request.body).digest('hex');
  if (sha256 !== request.sha256)
    throw new Error('Object SHA-256 does not match the uploaded bytes');
}
