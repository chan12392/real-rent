export type Office = { id: string; label: string }

export type Listing = {
  id: string
  label: string
  area: string
  available_from: string
  deposit_krw: number
  monthly_rent_krw: number
  monthly_management_krw: number | null
  management_includes: string[]
}

export type CommuteLeg = {
  minutes: number
  fare_krw: number
  transfers: number
  walk_minutes: number
}

export type Conditions = {
  office_id: string
  move_in_date: string
  deposit_limit_krw: number
  monthly_limit_krw: number
  workdays: number
  max_commute_minutes: number
  max_transfers: number
  priority: 'cost' | 'time'
}

export type Catalog = {
  synthetic: true
  note: string
  offices: Office[]
  listings: Listing[]
}

export type Candidate = {
  listing: Listing
  outbound: CommuteLeg
  inbound: CommuteLeg
  monthly_commute_krw: number
  monthly_total_krw: number
  round_trip_minutes: number
}

export type Comparison = {
  synthetic: true
  note: string
  conditions: Conditions
  office: Office
  candidates: Candidate[]
  excluded: { id: string; label: string; reasons: string[] }[]
  evaluated_count: number
  matched_count: number
}
