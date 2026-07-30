import { createHash } from 'node:crypto';
import {
  S3CompatibleObjectStorageAdapter,
  type S3CompatibleClient,
} from './s3-compatible-object-storage.adapter';

describe('S3CompatibleObjectStorageAdapter', () => {
  it('writes to a tenant prefix with checksum verification and server-side encryption', async () => {
    const client: jest.Mocked<S3CompatibleClient> = {
      putObject: jest.fn(),
      getObject: jest.fn(),
      deleteObject: jest.fn(),
    };
    const storage = new S3CompatibleObjectStorageAdapter(
      client,
      'private-evidence',
    );
    const body = Buffer.from('tenant-private-evidence');
    const sha256 = createHash('sha256').update(body).digest('hex');

    await storage.put({
      tenantId: 'tenant/a',
      objectName: 'artifact-1',
      body,
      mediaType: 'image/png',
      byteLength: body.byteLength,
      sha256,
    });

    expect(client.putObject.mock.calls).toHaveLength(1);
    const request = client.putObject.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(request).toEqual(
      expect.objectContaining({
        bucket: 'private-evidence',
        key: 'tenants/tenant%2Fa/evidence/artifact-1',
        checksumSha256: sha256,
        serverSideEncryption: 'AES256',
      }),
    );
    expect(request.acl).toBeUndefined();
  });
});
