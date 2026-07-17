import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Server } from 'node:http';
import { Socket } from 'node:net';
import { RunEvent } from '../entities';
import { SHOPPING_STORE, ShoppingStore } from '../repositories';
import { ViewerTokenService } from './viewer-token.service';

const EVENTS_PATH = /^\/api\/v1\/shopping\/runs\/([^/]+)\/events$/;
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PROTOCOL = 'dealpilot.events.v1';

@Injectable()
export class ShoppingEventStreamService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly clients = new Map<string, Set<Socket>>();
  private server?: Server;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly viewerTokens: ViewerTokenService,
    @Inject(SHOPPING_STORE) private readonly store: ShoppingStore,
  ) {}

  onApplicationBootstrap(): void {
    this.server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.server.on('upgrade', this.handleUpgrade);
  }

  onModuleDestroy(): void {
    this.server?.off('upgrade', this.handleUpgrade);
    for (const sockets of this.clients.values())
      for (const socket of sockets) socket.destroy();
    this.clients.clear();
  }

  publish(event: RunEvent): void {
    const frame = encodeFrame(JSON.stringify(eventEnvelope(event)));
    for (const socket of this.clients.get(event.runId) ?? [])
      if (socket.writable) socket.write(frame);
  }

  private readonly handleUpgrade = async (
    request: import('node:http').IncomingMessage,
    socket: Socket,
  ): Promise<void> => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const match = EVENTS_PATH.exec(requestUrl.pathname);
    if (!match) return;
    const runId = decodeURIComponent(match[1]);
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((item) => item.trim());
    const bearer = protocols.find((item) => item.startsWith('bearer.'));
    const token = bearer?.slice('bearer.'.length);
    const key = request.headers['sec-websocket-key'];
    if (
      requestUrl.searchParams.has('token') ||
      !protocols.includes(PROTOCOL) ||
      !token ||
      request.headers.upgrade?.toLowerCase() !== 'websocket' ||
      request.headers['sec-websocket-version'] !== '13' ||
      typeof key !== 'string'
    ) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    try {
      await this.viewerTokens.authorize(token, runId);
      const after = requestUrl.searchParams.get('after') ?? undefined;
      const history = await this.store.eventsAfter(runId, after, 200);
      const accept = createHash('sha1')
        .update(key + WEBSOCKET_GUID)
        .digest('base64');
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          `Sec-WebSocket-Protocol: ${PROTOCOL}`,
          '\r\n',
        ].join('\r\n'),
      );
      const sockets = this.clients.get(runId) ?? new Set<Socket>();
      sockets.add(socket);
      this.clients.set(runId, sockets);
      for (const event of history.events)
        socket.write(encodeFrame(JSON.stringify(eventEnvelope(event))));
      const remove = () => {
        sockets.delete(socket);
        if (!sockets.size) this.clients.delete(runId);
      };
      socket.on('close', remove);
      socket.on('error', remove);
      socket.on('data', (data) => {
        if ((data[0] & 0x0f) === 0x08) socket.end(closeFrame(1000));
      });
    } catch {
      rejectUpgrade(socket, 401, 'Unauthorized');
    }
  };
}

export function eventEnvelope(event: RunEvent) {
  return {
    id: event.eventId,
    runId: event.runId,
    type: event.type,
    status: event.status,
    timestamp: event.timestamp.toISOString(),
    payload: event.payload,
  };
}

function rejectUpgrade(socket: Socket, status: number, message: string): void {
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function encodeFrame(value: string): Buffer {
  const payload = Buffer.from(value);
  if (payload.length < 126)
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length <= 65_535) {
    const header = Buffer.allocUnsafe(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.allocUnsafe(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function closeFrame(code: number): Buffer {
  const payload = Buffer.allocUnsafe(2);
  payload.writeUInt16BE(code, 0);
  return Buffer.concat([Buffer.from([0x88, payload.length]), payload]);
}
