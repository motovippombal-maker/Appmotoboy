type RideAssignment = { driver_id?: string | null; accepted_at?: string | null };

export function rideAssignmentFilters(snapshot: RideAssignment) {
  return (["driver_id", "accepted_at"] as const).map((column) => ({
    column, operator: snapshot[column] ? "eq" : "is", value: snapshot[column] ?? null,
  }));
}

export function sameRideAssignment(expected: RideAssignment, current: RideAssignment) {
  const acceptedAt = (value?: string | null) => value ? Date.parse(value) : null;
  return (expected.driver_id ?? null) === (current.driver_id ?? null) &&
    acceptedAt(expected.accepted_at) === acceptedAt(current.accepted_at);
}
