import assert from "node:assert/strict";
import { test } from "node:test";
import { getRideService, RIDE_SERVICE_OPTIONS, rideServiceOfferDetails, rideServiceSchema } from "../lib/ride-service";
import { isRideServiceMigrationMissing, rideRequestSchema } from "../lib/backend/ride-request";
import { makeOfflineRide } from "../lib/offline/ride-store";
import type { Ride } from "../hooks/use-moto-vip";

const details = {
  description: "  Pedido 42: duas refeições  ",
  recipientName: "  Maria Silva  ",
  recipientPhone: "(75) 99999-1234",
  pickupNotes: "  Retirar no balcão  ",
  dropoffNotes: "  Chamar no portão  ",
};
const request = {
  origin: { address: "Restaurante da Praça", lat: -10.8373, lng: -38.5357 },
  destination: { address: "Rua do Destinatário, 20", lat: -10.8422, lng: -38.5299 },
  quoteToken: "q".repeat(40),
};

test("solicitações antigas continuam como passageiro e descartam detalhes de uma entrega anterior", () => {
  assert.deepEqual(rideServiceSchema.parse({}), { serviceType: "passenger", serviceDetails: {} });
  assert.deepEqual(rideServiceSchema.parse({ serviceType: "passenger", serviceDetails: { recipientPhone: "inválido", description: "x".repeat(1000) } }), {
    serviceType: "passenger", serviceDetails: {},
  });
  const parsed = rideRequestSchema.parse(request);
  assert.equal(parsed.serviceType, "passenger");
  assert.equal(parsed.paymentMethod, "cash");
  assert.deepEqual(parsed.origin, request.origin);
});

test("todos os serviços de entrega exigem descrição e contato normalizado do destinatário", () => {
  for (const service of RIDE_SERVICE_OPTIONS.filter((option) => option.id !== "passenger")) {
    const parsed = rideRequestSchema.parse({ ...request, serviceType: service.id, serviceDetails: details });
    assert.equal(parsed.serviceType, service.id);
    assert.deepEqual(parsed.serviceDetails, {
      description: "Pedido 42: duas refeições", recipientName: "Maria Silva", recipientPhone: "+5575999991234",
      pickupNotes: "Retirar no balcão", dropoffNotes: "Chamar no portão",
    });
    assert.equal(rideServiceSchema.safeParse({ serviceType: service.id }).success, false);
    for (const field of ["description", "recipientName", "recipientPhone"]) {
      assert.equal(rideServiceSchema.safeParse({ serviceType: service.id, serviceDetails: { ...details, [field]: " " } }).success, false);
    }
  }
});

test("valida telefone brasileiro, limites e serviço desconhecido sem aceitar campos financeiros enviados pelo cliente", () => {
  for (const phone of ["75999991234", "+55 (75) 99999-1234", "5575999991234", "(75) 3276-1234"]) {
    assert.ok(rideServiceSchema.safeParse({ serviceType: "delivery", serviceDetails: { ...details, recipientPhone: phone } }).success);
  }
  for (const phone of ["123", "+1 202 555 0199", "(00) 99999-1234", "(75) 09999-1234", "fone75999991234"]) {
    assert.equal(rideServiceSchema.safeParse({ serviceType: "delivery", serviceDetails: { ...details, recipientPhone: phone } }).success, false);
  }
  assert.equal(rideServiceSchema.safeParse({ serviceType: "unknown", serviceDetails: details }).success, false);
  for (const [field, length] of [["description", 501], ["recipientName", 101], ["pickupNotes", 301], ["dropoffNotes", 301]] as const) {
    assert.equal(rideServiceSchema.safeParse({ serviceType: "food", serviceDetails: { ...details, [field]: "x".repeat(length) } }).success, false);
  }
  const parsed = rideRequestSchema.parse({ ...request, serviceType: "food", serviceDetails: { ...details, productPrice: 999 }, fareCents: 1 });
  assert.equal("fareCents" in parsed, false);
  assert.equal("productPrice" in parsed.serviceDetails, false);
  assert.equal(rideRequestSchema.safeParse({ ...request, serviceType: "food", serviceDetails: details, quoteToken: "" }).success, false);
  assert.equal(rideRequestSchema.safeParse({ ...request, serviceType: "food", serviceDetails: details, origin: { ...request.origin, lat: 200 } }).success, false);
});

test("identifica banco sem migração sem esconder erros de outras colunas ou falhas de conexão", () => {
  assert.ok(isRideServiceMigrationMissing({ code: "PGRST204", message: "Could not find the 'service_type' column of 'rides' in the schema cache" }));
  assert.ok(isRideServiceMigrationMissing({ code: "42703", message: 'column "service_details" does not exist' }));
  assert.equal(isRideServiceMigrationMissing({ code: "42703", message: 'column "fare_cents" does not exist' }), false);
  assert.equal(isRideServiceMigrationMissing({ code: "500", message: "service_type request failed" }), false);
  assert.equal(isRideServiceMigrationMissing(null), false);
  assert.equal(getRideService(undefined).id, "passenger");
  assert.equal(getRideService("old-value").id, "passenger");
});

test("pacote offline preserva tipo, contato e instruções de entrega após o motorista aceitar", () => {
  const ride = {
    id: "ride-delivery", passenger_id: "requester", driver_id: "driver", status: "aceita",
    service_type: "food", service_details: { ...details, recipientPhone: "+5575999991234" },
    origin_address: "Restaurante", origin_lat: -10.8373, origin_lng: -38.5357,
    destination_address: "Casa", destination_lat: -10.8422, destination_lng: -38.5299,
    distance_meters: 1500, duration_seconds: 600, fare_cents: 700, payment_method: "cash",
    payment_status: "aguardando_pagamento", created_at: "2026-10-20T12:00:00Z",
  } satisfies Ride;
  const offline = makeOfflineRide(ride, "driver", null, null, true);
  assert.equal(offline.ride.service_type, "food");
  assert.deepEqual(offline.ride.service_details, ride.service_details);
  assert.notEqual(offline.ride.service_details, ride.service_details);
});

test("oferta mantém instruções do pedido sem divulgar o contato do destinatário aos motoristas ainda não vinculados", () => {
  const offered = rideServiceOfferDetails(details);
  assert.deepEqual(offered, { description: details.description, pickupNotes: details.pickupNotes, dropoffNotes: details.dropoffNotes });
  assert.equal("recipientName" in offered, false);
  assert.equal("recipientPhone" in offered, false);
  assert.equal(details.recipientName, "  Maria Silva  ");
  assert.deepEqual(rideServiceOfferDetails(null), {});
});
