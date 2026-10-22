/**
 * The proposal row shape and its mapping to the wire (Plan 06 Task 5).
 *
 * Kept apart from the read/write service so the column list, the row type and
 * the conversion live in one place: a venue column added here reaches every
 * read at once, and a card can never be given a shape the list does not produce.
 */

import type { Proposal, ProposalType, ProposalVenue } from '@/src/types/proposal';

/** One row of `PROPOSAL_COLUMNS`. */
export interface ProposalRow {
  id: string;
  event_id: string;
  type: ProposalType;
  title: string;
  notes: string | null;
  link: string | null;
  status: Proposal['status'];
  origin: Proposal['origin'];
  is_late: boolean;
  start_utc: Date | null;
  end_utc: Date | null;
  created_at: Date;
  proposer_id: string;
  proposer_name: string;
  venue_id: string | null;
  venue_name: string | null;
  venue_lat: string | null;
  venue_lng: string | null;
  venue_address: string | null;
  venue_provider_place_id: string | null;
  venue_opening_hours: unknown | null;
}

export const iso = (value: Date | string | null): string | null =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

/**
 * The columns every proposal read shares.
 *
 * Kept separate from the `from`/`join` half because the edit guard appends its
 * own columns, and SQL requires those in the SELECT list — not after the joins.
 */
export const PROPOSAL_COLUMNS = `
    pr.id, pr.event_id, pr.type, pr.title, pr.notes, pr.link,
    pr.status, pr.origin, pr.is_late, pr.start_utc, pr.end_utc, pr.created_at,
    p.id            as proposer_id,
    p.display_name  as proposer_name,
    v.id            as venue_id,
    v.name          as venue_name,
    v.lat::text     as venue_lat,
    v.lng::text     as venue_lng,
    v.address       as venue_address,
    v.provider_place_id as venue_provider_place_id,
    v.opening_hours as venue_opening_hours
`;

/** The joins behind `PROPOSAL_COLUMNS`. */
export const PROPOSAL_FROM = `
  from proposal pr
  join participant p on p.id = pr.created_by
  left join venue v  on v.id = pr.venue_id
`;

/** The full select every read shares. */
export const PROPOSAL_SELECT = `select ${PROPOSAL_COLUMNS} ${PROPOSAL_FROM}`;

function toVenue(row: ProposalRow): ProposalVenue | null {
  if (row.venue_id === null || row.venue_name === null) return null;

  return {
    id: row.venue_id,
    name: row.venue_name,
    // `numeric` arrives as a string from `pg`; the wire carries a number.
    lat: Number(row.venue_lat ?? 0),
    lng: Number(row.venue_lng ?? 0),
    address: row.venue_address,
    provider_place_id: row.venue_provider_place_id,
    // `null` is UNKNOWN, never closed (PRD-03 E9). The card renders «نامشخص».
    opening_hours: row.venue_opening_hours ?? null,
  };
}

export function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    event_id: row.event_id,
    type: row.type,
    title: row.title,
    notes: row.notes,
    link: row.link,
    status: row.status,
    origin: row.origin,
    is_late: row.is_late,
    start_utc: iso(row.start_utc),
    end_utc: iso(row.end_utc),
    venue: toVenue(row),
    proposer_id: row.proposer_id,
    proposer_name: row.proposer_name,
    created_at: iso(row.created_at) ?? '',
  };
}
