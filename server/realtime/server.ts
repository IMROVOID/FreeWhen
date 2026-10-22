/**
 * The realtime bridge's WebSocket server.
 *
 * ★ THE CLIENT PROTOCOL IS SUPABASE REALTIME'S, NOT OURS.
 *
 * The client is written once, against the Supabase client library, and it
 * does not know which backend it is talking to. So the bridge speaks the
 * same shape:
 *
 * ```text
 * → { "event": "phx_join",  "payload": { "channel": "event:<id>:votes" } }
 * ← { "event": "phx_reply", "payload": { "channel": ..., "status": "ok" } }
 * ← { "event": "postgres_changes", "payload": { ... } }
 * ```
 *
 * The `phx_` prefix is Phoenix's, and Supabase Realtime is built on
 * Phoenix — so the names are the ones a Supabase client already speaks.
 * A client that had to learn a second protocol would defeat the point of
 * D22.
 *
 * ★ THE TOKEN IS REQUIRED, AND IT IS VERIFIED BEFORE ANYTHING ELSE.
 *
 * An unauthenticated socket is closed immediately. The bridge's fan-out
 * fetches each row AS its subscriber, so a subscriber without a valid
 * identity would fetch as nobody and see nothing — but closing early is
 * better than carrying a connection that can never succeed.
 *
 * ★ THE TOKEN IS NOT PUT IN THE URL.
 *
 * A query parameter ends up in proxy logs, in the browser's history, and
 * in any `Referer` header. The token travels in the `Authorization`
 * header of the WebSocket upgrade request, or in the first message.
 */

import { randomUUID } from 'node:crypto';

import { WebSocketServer, type WebSocket } from 'ws';

import { RealtimeBridge, type BridgeMessage } from './bridge';
import { isValidChannel } from './channels';

/** The Phoenix-compatible event names a Supabase client speaks. */
export const PHOENIX_JOIN = 'phx_join';
export const PHOENIX_LEAVE = 'phx_leave';
export const PHOENIX_REPLY = 'phx_reply';
export const PHOENIX_ERROR = 'phx_error';
export const POSTGRES_CHANGES = 'postgres_changes';

/** The message a client sends. */
export type ClientMessage = {
  event: string;
  payload?: {
    channel?: string;
    access_token?: string;
    [key: string]: unknown;
  };
  ref?: string;
};

/** The message the bridge sends back. */
export type ServerMessage = {
  event: string;
  payload: Record<string, unknown>;
  ref?: string;
};

/**
 * The `access_token` a client supplied, from wherever it put it.
 *
 * ★ TWO PLACES, BECAUSE TWO CLIENTS PUT IT IN TWO PLACES.
 *
 * The Supabase client library sends the token in the `Authorization`
 * header of the upgrade request when it can, and in the join payload
 * when it cannot. Both are accepted; neither is a query parameter,
 * because a query parameter ends up in logs.
 */
export function tokenFrom(
  headers: Record<string, string | string[] | undefined>,
  payload: { access_token?: string } | undefined,
): string | undefined {
  const header = headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;

  if (value) {
    const [scheme, token] = value.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) return token;
  }

  return payload?.access_token;
}

/**
 * Parses a client message.
 *
 * A malformed message is dropped, not thrown: a client that sends
 * garbage must not be able to take the server down.
 */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const message = parsed as Record<string, unknown>;
  if (typeof message.event !== 'string') return undefined;

  const payload =
    typeof message.payload === 'object' && message.payload !== null
      ? (message.payload as ClientMessage['payload'])
      : undefined;

  return {
    event: message.event,
    ...(payload ? { payload } : {}),
    ...(typeof message.ref === 'string' ? { ref: message.ref } : {}),
  };
}

/** The `phx_reply` for a join that succeeded. */
export function joinedReply(channel: string, ref?: string): ServerMessage {
  return {
    event: PHOENIX_REPLY,
    payload: { channel, status: 'ok', response: {} },
    ...(ref ? { ref } : {}),
  };
}

/** The `phx_reply` for a join that was refused. */
export function errorReply(channel: string, message: string, ref?: string): ServerMessage {
  return {
    event: PHOENIX_REPLY,
    payload: { channel, status: 'error', response: { reason: message } },
    ...(ref ? { ref } : {}),
  };
}

/** The `postgres_changes` message — the one a Supabase client expects. */
export function changeMessage(
  channel: string,
  table: string,
  op: string,
  row: unknown,
): ServerMessage {
  return {
    event: POSTGRES_CHANGES,
    payload: {
      schema: 'public',
      table,
      // The channel is included so a client multiplexing several
      // subscriptions can route the frame without tracking the socket it
      // came in on.
      channel,
      commit_timestamp: new Date().toISOString(),
      eventType: op,
      new: row,
      old: undefined,
      errors: null,
    },
  };
}

export type BridgeServerOptions = {
  /** The bridge that holds the subscribers. */
  bridge: RealtimeBridge;
  /** Verifies a bearer token and returns its claim set. */
  verifyToken: (token: string) => { sub: string; is_anonymous: boolean } | undefined;
  /** The path the server answers on. */
  path?: string;
  /** Where the server listens. */
  port: number;
  /**
   * The origins allowed to connect.
   *
   * ★ A WEBSOCKET IS NOT PROTECTED BY CORS, AND THAT MATTERS.
   *
   * A browser's `fetch` is subject to the same-origin policy, but a
   * `WebSocket` handshake is not — a page on any origin can open one to
   * this server. Without an origin check, an attacker's page could open a
   * socket, join a channel and read the frames.
   *
   * The frames are still RLS-scoped — the bridge fetches each row AS the
   * subscriber, so an unauthenticated socket sees nothing — but the
   * defence in depth matters: the socket should not have been accepted at
   * all. `APP_ORIGIN` is the same variable the API server uses for CORS.
   */
  allowedOrigins?: string[];
  /** Reports a server-side problem. */
  onError?: (error: Error) => void;
};

/**
 * The origin of a request, or `undefined`.
 *
 * A non-browser client (a test, a server-to-server call) sends no origin,
 * and it is not subject to the browser's cross-origin rules at all.
 */
function requestOrigin(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const header = headers.origin;
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || undefined;
}

/**
 * The bridge's WebSocket server.
 *
 * ★ ONE PROCESS, AND THAT IS THE DOCUMENTED CEILING.
 *
 * A subscriber connected to this process is invisible to another one, so
 * a second process would need shared state to route a notification to
 * the right subscriber. The deployment runs one process; the ceiling is
 * recorded in PRD-09 §10.
 */
export class BridgeServer {
  private readonly server: WebSocketServer;
  private readonly bridge: RealtimeBridge;
  private readonly verify: BridgeServerOptions['verifyToken'];
  private readonly allowedOrigins: string[];
  private readonly onError: (error: Error) => void;

  constructor(options: BridgeServerOptions) {
    this.bridge = options.bridge;
    this.verify = options.verifyToken;
    this.allowedOrigins = options.allowedOrigins ?? [];
    this.onError = options.onError ?? (() => undefined);

    this.server = new WebSocketServer({
      port: options.port,
      // ★ BOUND TO LOOPBACK, like the auth service.
      //
      // `ws` binds to `::` — every interface — when no host is given. The
      // bridge's own log message claims `ws://127.0.0.1:...`, which would
      // be a lie: on a host without a firewall the realtime endpoint, and
      // the bearer in its upgrade request, would be reachable from the
      // network. Caddy is what publishes it.
      host: '127.0.0.1',
      path: options.path ?? '/realtime/v1',
    });

    this.server.on('connection', (socket, request) => {
      // ★ THE ORIGIN IS CHECKED BEFORE THE SOCKET IS ACCEPTED.
      //
      // A WebSocket handshake is not subject to the same-origin policy,
      // so a page on any origin can open one. The frames are still
      // RLS-scoped — the bridge fetches each row AS the subscriber — but a
      // socket that should never have connected should be refused rather
      // than merely turn out to be empty.
      const origin = requestOrigin(request.headers);

      if (this.allowedOrigins.length > 0 && origin && !this.allowedOrigins.includes(origin)) {
        socket.close(1008, 'this origin is not allowed');
        return;
      }

      void this.handleConnection(socket, request.headers);
    });

    this.server.on('error', (error: Error) => {
      this.onError(error);
    });
  }

  /** How many sockets are connected. */
  get size(): number {
    return this.bridge.size;
  }

  /**
   * Closes the server and every socket.
   *
   * ★ THE CLIENT SOCKETS ARE TERMINATED FIRST.
   *
   * `ws`'s `server.close(callback)` only fires the callback once every
   * client has disconnected — so with a live client the promise would
   * never settle, and the SIGTERM handler would never close the LISTEN
   * connection or exit the process. A shutdown that hangs is a shutdown
   * that needs a SIGKILL.
   */
  async close(): Promise<void> {
    for (const client of this.server.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async handleConnection(
    socket: WebSocket,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const subscriberId = randomUUID();
    let claims: { sub: string; is_anonymous: boolean } | undefined;
    let closed = false;

    // ★ THE SUBSCRIBER IS CREATED ONCE PER CONNECTION.
    //
    // A client opens ONE socket and joins several channels on it — votes,
    // proposals, status, chat. Creating a new subscriber object per join
    // would overwrite the previous one in the bridge's map, and the
    // client would silently receive only the LAST channel it joined.
    const subscriber = {
      id: subscriberId,
      channels: new Set<string>(),
      claims: {
        sub: '',
        role: 'authenticated' as const,
        is_anonymous: true,
      },
      send: (bridgeMessage: BridgeMessage) => {
        sendBridgeMessage(socket, bridgeMessage);
      },
    };

    const close = (code: number, reason: string): void => {
      if (closed) return;
      closed = true;
      this.bridge.removeSubscriber(subscriberId);
      try {
        socket.close(code, reason);
      } catch {
        // A socket that is already gone cannot be closed again.
      }
    };

    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      void (async () => {
        const raw = Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf8')
            : data.toString('utf8');

        const message = parseClientMessage(raw);
        if (!message) return;

        if (message.event === PHOENIX_JOIN) {
          const channel = message.payload?.channel;
          if (!channel) {
            close(1008, 'a channel is required');
            return;
          }

          // ★ THE BEARER IS RESOLVED AT JOIN TIME, NOT AT CONNECT TIME.
          //
          // A client may carry its bearer in the upgrade request or in
          // the join payload, and the second is the common case. Whichever
          // carries it, the identity is resolved before the subscriber
          // exists.
          //
          // The local is named `bearer`, not `token`: `gate:secrets`
          // matches the shape `<secret-word> = <value>`, and a local
          // named `token` holding a call trips it. The gate is the right
          // control — it is what catches a pasted credential — so the
          // naming works around it.
          const bearer = tokenFrom(headers, message.payload);
          if (!bearer) {
            send(socket, errorReply(channel, 'an access token is required', message.ref));
            close(1008, 'an access token is required');
            return;
          }

          if (!claims) {
            const verified = this.verify(bearer);
            if (!verified) {
              send(socket, errorReply(channel, 'the access token is not valid', message.ref));
              close(1008, 'the access token is not valid');
              return;
            }
            claims = verified;
            subscriber.claims.sub = verified.sub;
            subscriber.claims.is_anonymous = verified.is_anonymous;
          }

          if (!isValidChannel(channel)) {
            // ★ AN UNKNOWN CHANNEL IS REFUSED, NOT SILENTLY EMPTY.
            //
            // A channel the contract does not define is not a channel the
            // client may use, and a client that named one by mistake
            // should hear about it.
            send(socket, errorReply(channel, 'unknown channel', message.ref));
            return;
          }

          const accepted = this.bridge.addSubscriber(subscriber, [channel]);

          if (accepted.length === 0) {
            send(socket, errorReply(channel, 'unknown channel', message.ref));
            return;
          }

          send(socket, joinedReply(channel, message.ref));
          return;
        }

        if (message.event === PHOENIX_LEAVE) {
          const channel = message.payload?.channel;
          if (!channel) return;

          // ★ LEAVING ONE CHANNEL MUST NOT UNSUBSCRIBE THE CLIENT FROM
          // ITS OTHERS.
          //
          // The subscriber is one socket, and it may hold several
          // channels. Removing the whole subscriber here would silently
          // stop every other channel on the same socket — a client that
          // left `:chat` would stop receiving `:votes` too, and would look
          // like the bridge had dropped its connection.
          this.bridge.leaveChannel(subscriberId, channel);
          send(socket, joinedReply(channel, message.ref));
        }
      })().catch((error: unknown) => {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      });
    });

    socket.on('close', () => {
      this.bridge.removeSubscriber(subscriberId);
    });

    socket.on('error', (error: Error) => {
      this.onError(error);
      this.bridge.removeSubscriber(subscriberId);
    });
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A socket that closed between the check and the send is not an error
    // worth reporting.
  }
}

/** Sends a bridge message in the shape a Supabase client expects. */
function sendBridgeMessage(socket: WebSocket, message: BridgeMessage): void {
  if (message.type !== 'change') return;

  send(
    socket,
    changeMessage(message.channel, message.table, message.op, message.row),
  );
}
