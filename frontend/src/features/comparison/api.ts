import { requestApi } from '../../lib/api'
import type { Candidate, Catalog, CommuteLeg, Comparison, Conditions, Listing, Office } from './types'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function office(value: unknown): value is Office & Record<string, unknown> {
  return record(value) && typeof value.id === 'string' && typeof value.label === 'string'
}

function listing(value: unknown): value is Listing {
  return record(value) && office(value) && typeof value.area === 'string' &&
    typeof value.available_from === 'string' && nonnegative(value.deposit_krw) &&
    nonnegative(value.monthly_rent_krw) &&
    (value.monthly_management_krw === null || nonnegative(value.monthly_management_krw)) &&
    strings(value.management_includes)
}

function leg(value: unknown): value is CommuteLeg {
  return record(value) && nonnegative(value.minutes) && nonnegative(value.fare_krw) &&
    nonnegative(value.transfers) && nonnegative(value.walk_minutes) &&
    value.walk_minutes <= value.minutes
}

function conditions(value: unknown): value is Conditions {
  return record(value) && typeof value.office_id === 'string' &&
    typeof value.move_in_date === 'string' && nonnegative(value.deposit_limit_krw) &&
    nonnegative(value.monthly_limit_krw) && nonnegative(value.workdays) && value.workdays <= 31 &&
    nonnegative(value.max_commute_minutes) && nonnegative(value.max_transfers) &&
    (value.priority === 'cost' || value.priority === 'time')
}

function candidate(value: unknown): value is Candidate {
  return record(value) && listing(value.listing) && value.listing.monthly_management_krw !== null &&
    leg(value.outbound) && leg(value.inbound) && nonnegative(value.monthly_commute_krw) &&
    nonnegative(value.monthly_total_krw) && nonnegative(value.round_trip_minutes)
}

function isCatalog(value: unknown): value is Catalog {
  return record(value) && value.synthetic === true && typeof value.note === 'string' &&
    Array.isArray(value.offices) && value.offices.length > 0 && value.offices.every(office) &&
    Array.isArray(value.listings) && value.listings.every(listing)
}

function isComparison(value: unknown): value is Comparison {
  return record(value) && value.synthetic === true && typeof value.note === 'string' &&
    conditions(value.conditions) && office(value.office) &&
    Array.isArray(value.candidates) && value.candidates.length <= 3 && value.candidates.every(candidate) &&
    Array.isArray(value.excluded) && value.excluded.every((item: unknown) => (
      record(item) && office(item) && strings(item.reasons)
    )) && nonnegative(value.evaluated_count) && nonnegative(value.matched_count)
}

export function getCatalog(): Promise<Catalog> {
  return requestApi('/demo/catalog', isCatalog)
}

export function compareListings(input: Conditions): Promise<Comparison> {
  return requestApi('/compare', isComparison, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}
