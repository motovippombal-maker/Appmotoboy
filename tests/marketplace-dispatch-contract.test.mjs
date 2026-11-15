import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261115121000_marketplace_dispatch.sql");
const body = (name) => {
  const escaped = name.replace(".", "\\.");
  const match = sql.match(new RegExp(`create (?:or replace )?function ${escaped}\\(.*? as \\$\\$(.*?)\\$\\$;`, "s"));
  assert.ok(match, name);
  return match[1];
};

// These tests check migration/API contracts only. They do not apply SQL,
// run PostgreSQL or prove multi-connection concurrency.
test("market logistics migration follows orders and preserves regular ride uniqueness", () => {
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();
  assert.ok(migrations.indexOf("20261115120000_marketplace.sql") < migrations.indexOf("20261115121000_marketplace_dispatch.sql"));
  assert.match(sql, /one_active_ride_per_passenger[^;]+market_order_id is null[^;]+finalizada[^;]+cancelada/);
  assert.match(sql, /unique index market_order_one_active_ride[^;]+market_order_id is not null[^;]+finalizada[^;]+cancelada/);
  assert.doesNotMatch(sql, /drop index[^;]+one_active_ride_per_driver/);
  assert.match(body("public.expire_ride_searches"), /ride\.market_order_id is null/);
  assert.match(body("public.dispatch_next_offer"), /market_order_id is not null[\s\S]+dispatch_regular_ride_offer/);
});

test("hybrid dispatch is sequential, ranks pickup proximity and rejects stale or conflicting drivers", () => {
  const dispatch = body("public.dispatch_market_order");
  const eligibility = body("private.market_driver_eligible");
  const network = body("private.market_driver_pickup_distance");
  assert.match(network, /\(p_ride\)\.origin_lat,\(p_ride\)\.origin_lng,loc\.latitude,loc\.longitude/);
  for (const requirement of ["d.on_shift", "not d.queue_paused", "not p.blocked", "v.active", "r.driver_id=d.profile_id", "rr.status='pending'"])
    assert.ok(eligibility.includes(requirement), requirement);
  assert.doesNotMatch(eligibility, /driver_locations|gps_age_seconds/);
  assert.match(network, /market_driver_eligible[\s\S]+loc\.updated_at between[\s\S]+loc\.accuracy_meters between/);
  assert.match(dispatch, /preferred_driver_id[\s\S]+where d\.profile_id=preferred_driver and private\.market_driver_eligible[\s\S]+if chosen_driver is null then[\s\S]+market_driver_pickup_distance[\s\S]+order by distance\.meters,d\.profile_id/);
  assert.match(dispatch, /rr\.ride_id=current_ride\.id and rr\.driver_id=d\.profile_id/);
  assert.match(dispatch, /if offer_until is not null then[\s\S]+return false;[\s\S]+insert into public\.ride_requests/);
  assert.match(dispatch, /dispatch_exhausted_at=now\(\)/);
  assert.doesNotMatch(dispatch, /set status='cancelled'/);
});

test("market accept and exception actions use fresh offers and keep money out of the ride ledger", () => {
  const accept = body("public.accept_market_delivery");
  const driver = body("public.market_driver_delivery_action");
  assert.match(accept, /for update of o;[\s\S]+from public\.rides[^;]+for update;[\s\S]+from public\.drivers[^;]+for update;/);
  assert.match(accept, /expires_at>clock_timestamp\(\)[\s\S]+when 'preferred' then not private\.market_driver_eligible[\s\S]+else private\.market_driver_pickup_distance[\s\S]+logistics_status='assigned'/);
  assert.match(driver, /p_action='exception'[\s\S]+logistics_status='exception'[\s\S]+market_delivery_exception_at=now\(\)/);
  assert.match(driver, /p_action='withdraw'[^\n]+aceita[^\n]+motorista_chegou[\s\S]+logistics_status='awaiting_driver'/);
  assert.doesNotMatch(body("private.market_finish_delivery"), /market_cash_payments|payment_status\s*=\s*'pago'/);
  assert.match(body("private.reject_market_ride_payment"), /market_order_id is not null[\s\S]+raise exception/);
  assert.match(sql, /ensure_finished_ride_payment after update[\s\S]+when \(new\.market_order_id is null\)/);
});

test("market completion retries do not return recipient information", () => {
  const route = read("app/api/rides/[id]/transition/route.ts");
  const branch = route.match(/const action = input\.status === "em_corrida" \? "pickup" : "complete";([\s\S]+?)\n\s*\}/)?.[1];
  assert.ok(branch);
  assert.match(branch, /applyMarketDriverAction\(supabase, id, user\.id, action\)/);
  assert.match(branch, /Response\.json\(\{ rideId: id, status: updated\.status \}\)/);
  assert.doesNotMatch(branch, /service_details|ride: updated/);
  const active = read("app/api/rides/active/route.ts");
  const terminalSummary = active.match(/ride\.market_order_id && completedRide \? \{([\s\S]+?)\n\s*\} : \{/)?.[1];
  assert.ok(terminalSummary);
  assert.match(terminalSummary, /market_order_id: ride\.market_order_id/);
  assert.doesNotMatch(terminalSummary, /\.\.\.ride|passenger_id|destination_|origin_|route_geometry|recipient/);
});

test("market scheduler is authenticated and independent of any open passenger or driver screen", () => {
  const route = read("app/api/internal/marketplace/dispatch/route.ts");
  const dispatcher = read("lib/backend/marketplace-dispatch.ts");
  assert.match(route, /MARKETPLACE_DISPATCH_SECRET/);
  assert.match(route, /if \(!marketplaceDispatchAuthorized\([\s\S]+runMarketDispatch\(createSupabaseAdminClient\(\)\)/);
  assert.match(dispatcher, /timingSafeEqual\(token, expected\)/);
  assert.match(dispatcher, /rpc\("market_expire_orders"[\s\S]+rpc\("dispatch_due_market_orders"/);
  assert.match(body("public.dispatch_due_market_orders"), /dispatch_next_at<=now\(\)[\s\S]+limit greatest[\s\S]+for update of o skip locked/);
});
