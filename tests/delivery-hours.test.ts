import assert from "node:assert/strict";
import { test } from "node:test";
import { isWithinRestaurantHours } from "../lib/delivery/opening-hours";

test("horário do restaurante usa fuso da Bahia e aceita turno comum", () => {
  assert.equal(
    isWithinRestaurantHours("11:00", "14:00", new Date("2026-10-21T15:00:00Z")),
    true,
  );
  assert.equal(
    isWithinRestaurantHours("11:00", "14:00", new Date("2026-10-21T18:00:00Z")),
    false,
  );
});

test("turno que passa da meia-noite fecha no horário certo", () => {
  assert.equal(
    isWithinRestaurantHours("18:00", "02:00", new Date("2026-10-22T03:00:00Z")),
    true,
  );
  assert.equal(
    isWithinRestaurantHours("18:00", "02:00", new Date("2026-10-22T06:00:00Z")),
    false,
  );
});
