/**
 * The realtime bridge — LISTEN/NOTIFY → WebSocket (PRD-09 §4.0.1, PRD-10 D22).
 *
 * Supabase Realtime is a service this deployment does not have. On plain
 * PostgreSQL the same job is done by a small bridge: PostgreSQL notifies,
 * the bridge re-checks authorization, and the bridge pushes to the clients
 * that are allowed to see the change.
 *
 * ```text
 * INSERT/UPDATE → trigger → pg_notify('freewhen_realtime', json)
 *                                     ↓
 *                              the bridge
 *                                     ↓
 *                      fetch the row AS EACH SUBSCRIBER
 *                                     ↓
 *                          push to those subscribers only
 * ```
 *
 * ★★★ THE ONE RULE THAT MAKES THIS SAFE ★★★
 *
 * **The NOTIFY payload is a SIGNAL, never a row.**
 *
 * A trigger notifies `{table, id, op}` and nothing else. The bridge then
 * fetches the row **as the subscriber**, through the same RLS policies the
 * REST API uses. If the fetch returns no row, the subscriber is not told
 * anything.
 *
 * The alternative — broadcasting the row — is the single most dangerous
 * mistake available in this plan. A websocket that streams rows to whoever
 * connects bypasses RLS entirely: a client subscribed to one event would
 * receive another event's votes, and the row would be gone before any
 * policy could be consulted. The fetch-as-subscriber step IS the security
 * boundary, and it is not optional.
 *
 * ★ The payload limit is why the signal is a signal.
 *
 * `pg_notify` truncates at 8000 bytes. A `decision` row can exceed that,
 * and a truncated payload is not an error — it is a silent, corrupt one.
 * Notifying only `{table, id, op}` cannot hit the limit: the value is a
 * uuid and a two-letter opcode.
 *
 * ★ The 10-second polling fallback is unchanged (AC-10.6.1).
 *
 * The bridge is an OPTIMISATION. A client that misses a websocket frame
 * still converges on the next poll. That is why a dropped connection is a
 * degraded experience rather than a data-loss event, and it is why the
 * bridge's failure modes are allowed to be simple.
 *
 * ★ Single process, by design.
 *
 * A subscriber connected to process A is not visible to process B, so a
 * second bridge process would need shared state to route a notification to
 * the subscriber. The deployment runs one process; the ceiling is recorded
 * in PRD-09 §10.
 */

import type { Client, Pool, PoolClient } from 'pg';

import {
  NOTIFY_CHANNEL,
  PUBLISHED_TABLES,
  ROW_KEY,
  channelFor,
  isPublishedTable,
  isValidChannel,
  type PublishedTable,
} from './channels';

/** The operations a trigger can report. */
export type ChangeOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * The notification payload.
 *
 * ★ It carries an ID, not a row. See the file header.
 */
export type ChangeSignal = {
  table: PublishedTable;
  id: string;
  op: ChangeOperation;
  /** The event the changed row belongs to, when the trigger can name it. */
  event_id?: string;
};

/** A message the bridge sends to a client. */
export type BridgeMessage =
  | { type: 'subscribed'; channel: string; table: PublishedTable }
  | { type: 'unsubscribed'; channel: string }
  | { type: 'change'; channel: string; table: PublishedTable; op: ChangeOperation; row: unknown }
  | { type: 'error'; message: string };

/**
 * Fetches a row AS a given subscriber.
 *
 * ★ This is the security boundary, and it is an interface so that the
 * security property can be tested directly.
 *
 * The implementation must run the fetch with the SUBSCRIBER's claims in
 * effect, so the database's RLS policies decide whether the row is visible.
 * A fetch that runs as the service role would return every row to every
 * subscriber, and the bridge would become a data leak.
 */
export type RowFetcher = (args: {
  table: PublishedTable;
  id: string;
  subscriber: Subscriber;
}) => Promise<unknown | undefined>;

/** A connected client. */
export type Subscriber = {
  /** The client's id, for logs and for distinguishing connections. */
  id: string;
  /** The channels this subscriber is listening to. */
  channels: Set<string>;
  /** The subscriber's claims — what RLS will be evaluated against. */
  claims: {
    sub: string;
    role: 'authenticated';
    is_anonymous: boolean;
  };
  /** Sends a message to the client. */
  send(message: BridgeMessage): void;
};

/**
 * The uuid shape.
 *
 * ★ THE ROW ID IS VALIDATED BEFORE IT REACHES THE DATABASE.
 *
 * A malformed id would make PostgreSQL raise `invalid input syntax for
 * type uuid` — and that error, thrown inside the fan-out loop, would
 * abort the delivery to every REMAINING subscriber. One bad notification
 * would blind the channel.
 *
 * The validation is here rather than only in the fetch, because a
 * notification from any session on the database reaches this listener.
 */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses a NOTIFY payload.
 *
 * ★ A malformed payload is DROPPED, not thrown.
 *
 * The payload comes from a database trigger, so it is trusted in the sense
 * that the database produced it — but a `pg_notify` from ANY other session
 * on the same database reaches this listener too, and a third party with
 * database access could send one. A payload that does not parse is
 * discarded, and the bridge keeps running.
 */
export function parseSignal(payload: string): ChangeSignal | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const record = parsed as Record<string, unknown>;

  const table = record.table;
  if (typeof table !== 'string' || !isPublishedTable(table)) return undefined;

  const id = record.id;
  if (typeof id !== 'string' || !UUID_SHAPE.test(id)) return undefined;

  const op = record.op;
  if (op !== 'INSERT' && op !== 'UPDATE' && op !== 'DELETE') return undefined;

  const eventId = record.event_id;
  if (eventId !== undefined && typeof eventId !== 'string') return undefined;

  return {
    table,
    id,
    op,
    ...(typeof eventId === 'string' ? { event_id: eventId } : {}),
  };
}

/**
 * The bridge.
 *
 * The class holds the subscriber registry and the fan-out logic. The
 * transport — a `ws` server, a Postgres LISTEN connection — is injected, so
 * the security property can be tested without either.
 */
export class RealtimeBridge {
  private readonly subscribers = new Map<string, Subscriber>();
  private readonly fetchRow: RowFetcher;

  constructor(options: { fetchRow: RowFetcher }) {
    this.fetchRow = options.fetchRow;
  }

  /** How many subscribers are connected. */
  get size(): number {
    return this.subscribers.size;
  }

  /**
   * Registers a subscriber and its subscribed channels.
   *
   * ★ A SUBSCRIBER IS ONE SOCKET AND MAY HOLD SEVERAL CHANNELS.
   *
   * A second join on the same socket ADDS to the subscriber's channels;
   * it does not replace them. A client that joins `:votes` and then
   * `:proposals` — the normal case — must receive both.
   *
   * ★ A CHANNEL IS ACCEPTED ONLY IF IT IS ONE THE CONTRACT DEFINES.
   *
   * The channel name carries the event id, so accepting an arbitrary name
   * would let a client subscribe to an event it has no business naming.
   * The fetch-as-subscriber step would still deny the rows — but a channel
   * that does not exist should be refused rather than silently empty.
   */
  addSubscriber(subscriber: Subscriber, channels: string[]): string[] {
    const accepted: string[] = [];

    for (const channel of channels) {
      if (!isValidChannel(channel)) continue;
      subscriber.channels.add(channel);
      accepted.push(channel);
    }

    // ★ THE EXISTING SUBSCRIBER IS KEPT, so its channels survive.
    //
    // The map holds one entry per subscriber id, and a second join on the
    // same socket must not replace the first one — that would drop the
    // channels the client already had.
    const existing = this.subscribers.get(subscriber.id);
    if (existing && existing !== subscriber) {
      for (const channel of subscriber.channels) {
        existing.channels.add(channel);
      }
      return accepted;
    }

    this.subscribers.set(subscriber.id, subscriber);
    return accepted;
  }

  /** Removes a subscriber and its channels. */
  removeSubscriber(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  /**
   * Removes ONE channel from a subscriber, leaving its others.
   *
   * A subscriber is one socket, and it may hold several channels. Leaving
   * one must not unsubscribe the client from the rest — a client that left
   * `:chat` would otherwise stop receiving `:votes` too, and would look
   * like the bridge had dropped its connection.
   */
  leaveChannel(subscriberId: string, channel: string): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (!subscriber) return;

    subscriber.channels.delete(channel);

    // A subscriber with no channels left is not a subscriber any more,
    // and keeping it would hold a socket's identity in memory for ever.
    if (subscriber.channels.size === 0) {
      this.subscribers.delete(subscriberId);
    }
  }

  /** The channels a subscriber is listening to. */
  channelsOf(subscriberId: string): string[] {
    const subscriber = this.subscribers.get(subscriberId);
    return subscriber ? [...subscriber.channels] : [];
  }

  /**
   * Handles one change signal and fans it out.
   *
   * ★ The per-subscriber fetch is the boundary.
   *
   * For each subscriber, the row is fetched with THAT subscriber's claims.
   * A subscriber who cannot see the row is not sent a message — not a
   * message with an empty body, and not a "something happened" notice. They
   * are sent nothing at all, because a notification that a change occurred
   * is itself a disclosure.
   *
   * @returns how many subscribers were told.
   */
  async handleSignal(signal: ChangeSignal): Promise<number> {
    // The channel the change belongs to. Computed ONCE, from the event the
    // trigger named — so a change in event A routes to event A's channel
    // and to nothing else.
    if (!signal.event_id) return 0;

    const channel = channelFor(signal.table, signal.event_id);

    let delivered = 0;

    for (const subscriber of this.subscribers.values()) {
      // Not subscribed to this channel — not told, and not even queried.
      if (!subscriber.channels.has(channel)) continue;

      // ★ ONE SUBSCRIBER'S FAILURE MUST NOT BLIND THE CHANNEL.
      //
      // The fetch can fail — a connection dropped, a row deleted
      // mid-flight, a type mismatch. An uncaught error here would
      // propagate out of `handleSignal` and skip every REMAINING
      // subscriber, so one bad fetch would blind the channel for
      // everyone.
      let row: unknown;
      try {
        row = await this.fetchRow({
          table: signal.table,
          id: signal.id,
          subscriber,
        });
      } catch {
        // This subscriber is skipped; the others still get their rows.
        continue;
      }

      // No row means RLS denied it. The subscriber learns nothing.
      if (row === undefined) continue;

      subscriber.send({
        type: 'change',
        channel,
        table: signal.table,
        op: signal.op,
        row,
      });
      delivered += 1;
    }

    return delivered;
  }
}

/**
 * A row fetcher that runs the fetch AS the subscriber.
 *
 * ★ The claims are set on the SAME connection as the query.
 *
 * `request.jwt.claims` is a session-level GUC and `set role` is
 * session-level too, so both must be set on the connection that runs the
 * query. Setting them on one connection and querying on another would
 * fetch the row as whatever role that other connection happens to be —
 * which, for a pooled connection, is the service role. That is the exact
 * leak this whole design exists to prevent.
 *
 * ★ The role is reset afterwards, for the same reason `closeSession` resets
 * it in the DB test suite: a pooled connection is reused, and a connection
 * left running as `authenticated` with somebody else's claims would answer
 * the NEXT borrower with the wrong identity.
 */
export function createSubscriberFetcher(pool: Pool): RowFetcher {
  return async ({ table, id, subscriber }): Promise<unknown | undefined> => {
    const client: PoolClient = await pool.connect();
    let released = false;

    /**
     * Returns the connection to the pool, or DISCARDS it.
     *
     * ★ `client.release(error)` is how pg-pool is told to destroy a
     * connection rather than return it. A connection whose state is
     * unknown must never go back into the pool.
     */
    const release = (error?: Error): void => {
      if (released) return;
      released = true;
      client.release(error);
    };

    try {
      const claims = JSON.stringify({
        sub: subscriber.claims.sub,
        role: subscriber.claims.role,
        is_anonymous: subscriber.claims.is_anonymous,
      });

      await client.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
      await client.query('set role authenticated');

      const result = await client.query(
        `select * from ${quoteIdentifier(table)} where ${quoteIdentifier(ROW_KEY[table])} = $1`,
        [id],
      );

      return result.rows[0];
    } catch (error) {
      // ★ A FAILED QUERY LEAVES THE CONNECTION IN AN UNKNOWN STATE.
      //
      // The claims GUC and the role are still set on it, and the query may
      // have failed mid-flight. Returning it to the pool would hand the
      // next borrower a session running as `authenticated` with somebody
      // else's claims — which is the exact leak this design exists to
      // prevent.
      release(new Error('the subscriber fetch failed; discarding the connection'));
      throw error;
    } finally {
      if (!released) {
        try {
          await client.query('reset role');
          await client.query('reset request.jwt.claims');
          release();
        } catch {
          // A connection that could not be reset is in an unknown state.
          release(new Error('the connection could not be reset; discarding it'));
        }
      }
    }
  };
}

/**
 * Quotes a table identifier.
 *
 * The table name comes from the PUBLISHED_TABLES allowlist, never from a
 * client, so it is not attacker-controlled. It is still quoted, because a
 * future edit that widens the allowlist should not silently become an
 * injection point.
 */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * The SQL that raises the notification.
 *
 * ★ The payload is `{table, id, op, event_id}` — a signal, not a row.
 *
 * The function is installed by migration `015`, which this plan owns. It
 * is exported here so the trigger and the bridge agree on the channel name
 * and the payload shape, and so the test suite can assert them together.
 */
export const NOTIFY_FUNCTION_SQL = `
create or replace function freewhen_notify_change()
returns trigger
language plpgsql
as $$
declare
  v_context jsonb;
  v_table   text;
begin
  v_table := tg_table_name;
  v_context := freewhen_change_context(v_table, to_jsonb(coalesce(new, old)));

  if v_context is null then
    return coalesce(new, old);
  end if;

  perform pg_notify(
    'freewhen_realtime',
    json_build_object(
      'table', v_table,
      'id', v_context->>'id',
      'op', upper(tg_op),
      'event_id', v_context->>'event_id'
    )::text
  );

  return coalesce(new, old);
end;
$$;
`;

/**
 * The routing context of a changed row.
 *
 * ★ The event id is read FROM THE ROW, not by re-querying the table.
 *
 * That is what makes DELETE work: on a delete the row is already gone, so
 * a resolver that looked the row up by id would find nothing and the
 * notification would carry no event — the change would be undeliverable.
 *
 * `vote` is the exception: it reaches its event through its proposal, so
 * one lookup is needed, and it is made from the row's own `proposal_id`.
 */
export const NOTIFY_CONTEXT_SQL = `
create or replace function freewhen_change_context(p_table text, p_row jsonb)
returns jsonb
language sql
stable
as $$
  select case p_table
    when 'event' then
      jsonb_build_object('id', p_row->>'id', 'event_id', p_row->>'id')
    when 'proposal' then
      jsonb_build_object('id', p_row->>'id', 'event_id', p_row->>'event_id')
    when 'rsvp' then
      jsonb_build_object('id', p_row->>'participant_id', 'event_id', p_row->>'event_id')
    when 'event_message' then
      jsonb_build_object('id', p_row->>'id', 'event_id', p_row->>'event_id')
    when 'vote' then
      jsonb_build_object(
        'id', p_row->>'id',
        'event_id', (
          select pt.event_id
          from public.participant pt
          where pt.id = (p_row->>'participant_id')::uuid
        )
      )
    else null
  end;
$$;
`;

/**
 * Starts the LISTEN connection and pumps signals into the bridge.
 *
 * ★ A dedicated connection.
 *
 * A LISTEN takes a session-level lock on the channel, and a pooled
 * connection that is handed to another borrower while still listening would
 * deliver notifications to a transaction that is not expecting them. The
 * listener therefore gets its own connection, outside the pool.
 */
export async function startListener(
  client: Client,
  bridge: RealtimeBridge,
  onError?: (error: Error) => void,
): Promise<void> {
  await client.query(`listen ${quoteIdentifier(NOTIFY_CHANNEL)}`);

  client.on('notification', (message) => {
    if (message.channel !== NOTIFY_CHANNEL) return;
    if (!message.payload) return;

    const signal = parseSignal(message.payload);
    if (!signal) return;

    // The fan-out is async, and a rejection must not become an unhandled
    // error that takes the process down.
    void bridge.handleSignal(signal).catch((error: unknown) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  });

  client.on('error', (error: Error) => {
    onError?.(error);
  });
}

/** The tables a trigger is installed on. Re-exported for the migration. */
export const NOTIFIED_TABLES = PUBLISHED_TABLES;
