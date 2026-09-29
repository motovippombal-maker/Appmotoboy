import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  canActivateWithKeyboard,
  historyPanelState,
  mobileNavItem,
  nextPassengerMobileView,
  notificationPanelState,
  shouldLockBackground,
} from "../lib/mobile/passenger-navigation";

const root = process.cwd();
const pageSource = await readFile(path.join(root, "app", "page.tsx"), "utf8");
const cssSource = await readFile(path.join(root, "app", "globals.css"), "utf8");
const layoutSource = await readFile(path.join(root, "app", "layout.tsx"), "utf8");
const passengerHistoryRoute = await readFile(
  path.join(root, "app", "api", "history", "passenger", "route.ts"),
  "utf8",
);
const driverHistoryRoute = await readFile(
  path.join(root, "app", "api", "history", "driver", "route.ts"),
  "utf8",
);

test("1. tocar em Corridas abre o histórico mobile", () => {
  const view = nextPassengerMobileView("home", "open-rides");
  assert.equal(view, "rides");
  assert.equal(mobileNavItem(view), "rides");
});

test("2. tocar em Início fecha o histórico e ativa somente Início", () => {
  const view = nextPassengerMobileView("rides", "open-home");
  assert.equal(view, "home");
  assert.equal(mobileNavItem(view), "home");
});

test("3. Conta é a única aba ativa em conta e notificações", () => {
  assert.equal(mobileNavItem(nextPassengerMobileView("home", "open-profile")), "profile");
  assert.equal(mobileNavItem("notifications"), "profile");
});

test("4. histórico vazio produz estado vazio sem conteúdo fictício", () => {
  assert.equal(historyPanelState({ loading: false, count: 0 }), "empty");
  assert.match(pageSource, /Você ainda não possui corridas\./);
});

test("5. histórico preenchido produz estado de sucesso e usa dados da corrida", () => {
  assert.equal(historyPanelState({ loading: false, count: 2 }), "success");
  assert.match(pageSource, /item\.origin_address/);
  assert.match(pageSource, /item\.destination_address/);
  assert.match(pageSource, /item\.driver_name/);
});

test("6. erro no histórico é controlado e permite tentar novamente", () => {
  assert.equal(
    historyPanelState({ loading: false, error: "offline", count: 0 }),
    "error",
  );
  assert.match(pageSource, /reloadPassengerHistory/);
  assert.match(pageSource, /Tentar novamente/);
});

test("7. histórico do motorista exige papel driver e filtra pelo próprio usuário", () => {
  assert.match(driverHistoryRoute, /requireUser\(request, \["driver"\]\)/);
  assert.match(driverHistoryRoute, /\.eq\("driver_id", user\.id\)/);
  assert.doesNotMatch(driverHistoryRoute, /passengerHistory/);
});

test("8. histórico do passageiro exige papel passenger e filtra pelo próprio usuário", () => {
  assert.match(passengerHistoryRoute, /requireUser\(request, \["passenger"\]\)/);
  assert.match(passengerHistoryRoute, /\.eq\("passenger_id", user\.id\)/);
});

test("9. notificações mobile têm painel próprio acima do mapa", () => {
  assert.equal(
    notificationPanelState({ loading: false, count: 1 }),
    "success",
  );
  assert.match(cssSource, /\.passenger-mobile-panel\s*\{[\s\S]*?z-index:\s*1150/);
  assert.match(pageSource, /view === "notifications"/);
});

test("10. fechar notificações restaura o nível Conta e libera o fundo", () => {
  const next = nextPassengerMobileView("notifications", "back");
  assert.equal(next, "profile");
  assert.equal(shouldLockBackground(next), true);
  assert.equal(shouldLockBackground("home"), false);
  assert.match(pageSource, /document\.body\.style\.overflow = previousOverflow/);
});

test("11. painel longo rola no conteúdo e contém o gesto", () => {
  assert.match(
    cssSource,
    /\.passenger-mobile-panel-content\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?touch-action:\s*pan-y;/,
  );
  assert.match(cssSource, /overscroll-behavior:\s*contain/);
});

test("12. toque em botão ou aba possui feedback visual imediato", () => {
  assert.match(cssSource, /\.passenger-bottom-nav button:active/);
  assert.match(cssSource, /transform:\s*scale\(0\.96\)/);
});

test("13. painel com teclado virtual mantém conteúdo e ações roláveis", () => {
  assert.match(
    cssSource,
    /grid-template-rows:\s*auto minmax\(0, 1fr\)/,
  );
  assert.match(cssSource, /scroll-padding-bottom:\s*96px/);
});

test("14. Voltar de detalhes retorna ao histórico", () => {
  assert.equal(nextPassengerMobileView("ride-details", "back"), "rides");
});

test("15. reload inicia em Início e corrida ativa fecha painel transitório", () => {
  assert.match(pageSource, /useState<PassengerMobileView>\("home"\)/);
  assert.match(pageSource, /if \(!activeRide \|\| mobileView === "home"\) return/);
});

test("16. painel mobile permanece oculto no desktop", () => {
  assert.match(cssSource, /\.passenger-mobile-panel\s*\{\s*display:\s*none;/);
  assert.match(cssSource, /@media \(max-width:\s*950px\)[\s\S]*?\.passenger-mobile-panel/);
});

test("17. zoom do navegador não é bloqueado", () => {
  assert.doesNotMatch(layoutSource, /maximumScale/);
  assert.doesNotMatch(layoutSource, /user-scalable/i);
});

test("18. ações principais aceitam teclado e exibem foco visível", () => {
  assert.equal(canActivateWithKeyboard("Enter"), true);
  assert.equal(canActivateWithKeyboard(" "), true);
  assert.equal(canActivateWithKeyboard("Escape"), false);
  assert.match(cssSource, /button:focus-visible/);
  assert.match(cssSource, /outline:\s*3px solid/);
});
