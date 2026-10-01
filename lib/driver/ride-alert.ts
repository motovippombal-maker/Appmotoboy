export const DRIVER_ALERT_PREFERENCES_KEY = "moto-pombal:driver-alerts";

export type DriverAlertPreferences = {
  notifications: boolean;
  sound: boolean;
  vibration: boolean;
};

export const DEFAULT_DRIVER_ALERT_PREFERENCES: DriverAlertPreferences = {
  notifications: true,
  sound: true,
  vibration: true,
};

export function parseDriverAlertPreferences(value: string | null): DriverAlertPreferences {
  if (!value) return DEFAULT_DRIVER_ALERT_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Partial<DriverAlertPreferences>;
    return {
      notifications: parsed.notifications !== false,
      sound: parsed.sound !== false,
      vibration: parsed.vibration !== false,
    };
  } catch {
    return DEFAULT_DRIVER_ALERT_PREFERENCES;
  }
}

type BrowserAudioContext = AudioContext & { resume: () => Promise<void> };

export class RideAlertController {
  private context: BrowserAudioContext | null = null;
  private ringTimer: number | null = null;
  private vibrationTimer: number | null = null;
  private oscillators = new Set<OscillatorNode>();
  private active = false;
  private generation = 0;

  async unlock() {
    if (typeof window === "undefined") return;
    const AudioContextConstructor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    this.context ||= new AudioContextConstructor() as BrowserAudioContext;
    if (this.context.state === "suspended") await this.context.resume().catch(() => undefined);
  }

  async start(preferences: DriverAlertPreferences) {
    this.stop();
    const generation = this.generation;
    this.active = true;
    if (preferences.sound) {
      await this.unlock().catch(() => undefined);
      if (!this.active || generation !== this.generation) return;
      this.ring();
      this.ringTimer = window.setInterval(() => this.ring(), 1_900);
    }
    if (!this.active || generation !== this.generation) return;
    if (preferences.vibration && typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([450, 160, 450, 160, 700]);
      this.vibrationTimer = window.setInterval(
        () => navigator.vibrate([450, 160, 450, 160, 700]),
        2_500,
      );
    }
  }

  stop() {
    this.generation += 1;
    this.active = false;
    if (this.ringTimer !== null) window.clearInterval(this.ringTimer);
    if (this.vibrationTimer !== null) window.clearInterval(this.vibrationTimer);
    this.ringTimer = null;
    this.vibrationTimer = null;
    this.oscillators.forEach((oscillator) => {
      try { oscillator.stop(); } catch { /* already stopped */ }
    });
    this.oscillators.clear();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(0);
  }

  isActive() {
    return this.active;
  }

  private ring() {
    const context = this.context;
    if (!this.active || !context || context.state !== "running") return;
    const start = context.currentTime;
    const notes = [
      { at: 0, frequency: 880 },
      { at: 0.24, frequency: 1_175 },
      { at: 0.52, frequency: 880 },
      { at: 0.76, frequency: 1_320 },
    ];
    notes.forEach(({ at, frequency }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, start + at);
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.17, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + 0.22);
      this.oscillators.add(oscillator);
      oscillator.addEventListener("ended", () => this.oscillators.delete(oscillator), { once: true });
    });
  }
}
