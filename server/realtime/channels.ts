/**
 * Realtime channel naming and the published-table allowlist
 * (PRD-09 §3.5, §4.0.1, PRD-02, PRD-06 FR-6.7b).
 *
 * ★ The channel names ARE the client contract.
 *
 * Supabase Realtime and the local WebSocket bridge both speak these exact
 * names, so the client is written once. The names come from the PRDs, not
 * from this file:
 *
 * | Channel | Source |
 * |---|---|
 * | `event:{id}:votes` | PRD-02 §8 |
 * | `event:{id}:proposals` | PRD-02 §8 |
 * | `event:{id}:status` | PRD-02 §8 |
 * | `event:{id}:chat` | PRD-06 FR-6.7b |
 *
 * ★ The published-table allowlist is a SECURITY boundary, not a
 * convenience.
 *
 * The realtime publication carries exactly five tables (PRD-09 §3.5):
 * `vote`, `proposal`, `rsvp`, `event`, `event_message`. Three are
 * deliberately EXCLUDED:
 *
 * | Excluded | Why |
 * |---|---|
 * | `start_point` | A location change broadcast to every participant of every event is a privacy leak (FR-8.15). |
 * | `travel_measurement` | A high-churn shared cache. Broadcasting it would flood the channel with data nobody is allowed to read. |
 * | `activity_log` | The audit trail, read on demand. |
 *
 * The allowlist here mirrors that. A table that is not on it is never
 * notified, so a migration that adds a table by mistake cannot start
 * streaming it.
 */

/** The five tables on the realtime publication (PRD-09 §3.5). */
export const PUBLISHED_TABLES = [
  'vote',
  'proposal',
  'rsvp',
  'event',
  'event_message',
] as const;

export type PublishedTable = (typeof PUBLISHED_TABLES)[number];

/** The tables that must never be streamed, and why. */
export const EXCLUDED_TABLES = {
  start_point: 'location changes are a privacy leak (FR-8.15)',
  travel_measurement: 'high-churn shared cache, not client-readable',
  activity_log: 'the audit trail is read on demand',
} as const;

/** Whether a table may be streamed. */
export function isPublishedTable(table: string): table is PublishedTable {
  return (PUBLISHED_TABLES as readonly string[]).includes(table);
}

/**
 * The event a streamed row belongs to.
 *
 * ★ Each table reaches its event differently, and getting this wrong means
 * a subscriber is told about the wrong event — or about an event at all.
 *
 * | Table | Path to the event |
 * |---|---|
 * | `event` | it IS the event |
 * | `vote` | → `proposal` → `event` |
 * | `proposal` | → `event` |
 * | `rsvp` | → `event` |
 * | `event_message` | → `event` |
 *
 * `comment` is deliberately absent: it is not on the publication, so it has
 * no path here.
 */
export const EVENT_PATH: Record<PublishedTable, readonly string[]> = {
  event: [],
  proposal: ['proposal'],
  vote: ['vote', 'proposal'],
  rsvp: ['rsvp'],
  event_message: ['event_message'],
};

/**
 * The column that identifies a row, per table.
 *
 * ★ `rsvp` is the exception.
 *
 * Four of the five published tables have an `id uuid primary key`. `rsvp`
 * does not — its primary key IS the participant id, because one participant
 * has one RSVP and a second one is a primary-key violation rather than a
 * silent overwrite. So the row key of an rsvp row is `participant_id`, and
 * a trigger that read `new.id` would notify a NULL.
 */
export const ROW_KEY: Record<PublishedTable, string> = {
  event: 'id',
  proposal: 'id',
  vote: 'id',
  rsvp: 'participant_id',
  event_message: 'id',
};

/** The channel name for an event's votes. */
export function votesChannel(eventId: string): string {
  return `event:${eventId}:votes`;
}

/** The channel name for an event's proposals. */
export function proposalsChannel(eventId: string): string {
  return `event:${eventId}:proposals`;
}

/** The channel name for an event's status. */
export function statusChannel(eventId: string): string {
  return `event:${eventId}:status`;
}

/** The channel name for an event's in-room chat. */
export function chatChannel(eventId: string): string {
  return `event:${eventId}:chat`;
}

/** Every channel name an event can be subscribed to. */
export function eventChannels(eventId: string): string[] {
  return [
    votesChannel(eventId),
    proposalsChannel(eventId),
    statusChannel(eventId),
    chatChannel(eventId),
  ];
}

/** The PostgreSQL channel the trigger notifies on. */
export const NOTIFY_CHANNEL = 'freewhen_realtime';

/** The channel kinds, and the table each one carries. */
export const CHANNEL_TABLE = {
  votes: 'vote',
  proposals: 'proposal',
  status: 'event',
  chat: 'event_message',
} as const satisfies Record<string, PublishedTable>;

export type ChannelKind = keyof typeof CHANNEL_TABLE;

/**
 * The channel a table's changes are delivered on.
 *
 * ★ The reverse of `CHANNEL_TABLE`, plus `rsvp`.
 *
 * `rsvp` is on the realtime publication (PRD-09 §3.5) but the PRDs name no
 * channel for it. It is event STATE, so it rides the `status` channel —
 * the same channel the event's own status changes ride.
 */
export const TABLE_CHANNEL: Record<PublishedTable, ChannelKind> = {
  vote: 'votes',
  proposal: 'proposals',
  event: 'status',
  rsvp: 'status',
  event_message: 'chat',
};

/**
 * The table a channel carries, or `undefined` for an unknown channel.
 *
 * The lookup is by the channel's KIND — the last segment of the name —
 * because the id is a uuid and the names are the contract. A channel this
 * function does not recognise is not a channel the client may use.
 */
export function channelTable(channel: string): PublishedTable | undefined {
  const kind = channelKind(channel);
  return kind ? CHANNEL_TABLE[kind] : undefined;
}

/**
 * The kind of a channel, or `undefined` for an unknown channel.
 *
 * A channel name is `event:{id}:{kind}`.
 */
export function channelKind(channel: string): ChannelKind | undefined {
  const match = /^event:[0-9a-fA-F-]{36}:([a-z]+)$/.exec(channel);
  const kind = match?.[1];
  if (!kind) return undefined;
  return kind in CHANNEL_TABLE ? (kind as ChannelKind) : undefined;
}

/**
 * The event id a channel refers to, or `undefined` for an unknown channel.
 *
 * The id is a uuid, so the parse is exact: a channel whose id is not a uuid
 * is not a channel.
 */
export function channelEventId(channel: string): string | undefined {
  const match =
    /^event:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}):[a-z]+$/.exec(
      channel,
    );
  return match?.[1];
}

/** Whether a channel name is one this service accepts. */
export function isValidChannel(channel: string): boolean {
  return channelEventId(channel) !== undefined && channelTable(channel) !== undefined;
}

/**
 * The channel a change on a table belongs to, for an event.
 *
 * ★ This is how the bridge ROUTES a change.
 *
 * The bridge computes the ONE channel the change belongs to and delivers to
 * that channel only. Cross-event isolation is therefore structural — a
 * change in event A cannot be delivered on event B's channel, because
 * event B's channel is not the channel the change routes to.
 */
export function channelFor(table: PublishedTable, eventId: string): string {
  const kind = TABLE_CHANNEL[table];
  return `event:${eventId}:${kind}`;
}
