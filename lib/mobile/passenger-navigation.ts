export type PassengerMobileView =
  | "home"
  | "rides"
  | "ride-details"
  | "profile"
  | "notifications";

export type PassengerMobileAction =
  | "open-home"
  | "open-rides"
  | "open-ride-details"
  | "open-profile"
  | "open-notifications"
  | "back";

export function mobileNavItem(view: PassengerMobileView) {
  if (view === "rides" || view === "ride-details") return "rides" as const;
  if (view === "profile" || view === "notifications") return "profile" as const;
  return "home" as const;
}

export function nextPassengerMobileView(
  current: PassengerMobileView,
  action: PassengerMobileAction,
): PassengerMobileView {
  if (action === "open-home") return "home";
  if (action === "open-rides") return "rides";
  if (action === "open-ride-details") return "ride-details";
  if (action === "open-profile") return "profile";
  if (action === "open-notifications") return "notifications";
  if (current === "ride-details") return "rides";
  if (current === "notifications") return "profile";
  return "home";
}

export function shouldLockBackground(view: PassengerMobileView) {
  return view !== "home";
}

export type AsyncPanelState = "loading" | "empty" | "success" | "error";

export function historyPanelState(input: {
  loading: boolean;
  error?: string | null;
  count: number;
}): AsyncPanelState {
  if (input.loading) return "loading";
  if (input.error) return "error";
  return input.count > 0 ? "success" : "empty";
}

export function notificationPanelState(input: {
  loading: boolean;
  error?: string | null;
  count: number;
}): AsyncPanelState {
  return historyPanelState(input);
}

export function canActivateWithKeyboard(key: string) {
  return key === "Enter" || key === " ";
}
