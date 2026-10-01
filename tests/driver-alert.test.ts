import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DRIVER_ALERT_PREFERENCES,
  RideAlertController,
  parseDriverAlertPreferences,
} from "../lib/driver/ride-alert";

test("alertas do motorista vêm ativos por padrão", () => {
  assert.deepEqual(parseDriverAlertPreferences(null), DEFAULT_DRIVER_ALERT_PREFERENCES);
});

test("preferências persistidas permitem desligar cada canal", () => {
  assert.deepEqual(
    parseDriverAlertPreferences(JSON.stringify({
      notifications: false,
      sound: false,
      vibration: true,
    })),
    { notifications: false, sound: false, vibration: true },
  );
});

test("preferências inválidas recuperam configuração segura", () => {
  assert.deepEqual(parseDriverAlertPreferences("{inválido"), DEFAULT_DRIVER_ALERT_PREFERENCES);
});

test("aceite durante desbloqueio do áudio não reinicia som ou vibração", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const intervals: number[] = [];
  const vibrations: number[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setInterval: (_callback: () => void, delay: number) => { intervals.push(delay); return intervals.length; },
    clearInterval: () => undefined,
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    vibrate: (pattern: number | number[]) => { vibrations.push(Array.isArray(pattern) ? pattern[0] : pattern); return true; },
  } });
  try {
    let finishUnlock!: () => void;
    const unlock = new Promise<void>((resolve) => { finishUnlock = resolve; });
    const controller = new RideAlertController();
    controller.unlock = () => unlock;
    const starting = controller.start({ notifications: false, sound: true, vibration: true });
    controller.stop();
    finishUnlock();
    await starting;
    assert.equal(controller.isActive(), false);
    assert.deepEqual(intervals, []);
    assert.deepEqual(vibrations, [0, 0]);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
