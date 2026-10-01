import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const auth = await readFile(path.join(root, "components", "auth", "auth-portal.tsx"), "utf8");
const css = await readFile(path.join(root, "app", "brand-overrides.css"), "utf8");
const page = await readFile(path.join(root, "app", "page.tsx"), "utf8");

test("login mobile usa celular e senha sem exigir e-mail", () => {
  assert.match(auth, /await onSignIn\(phone, form\.password\)/);
  assert.match(auth, /placeholder="Celular ou WhatsApp"/);
  assert.match(auth, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(auth, /changeMode\("reset"\)/);
  assert.doesNotMatch(auth, /type="email"|placeholder="[^"]*e-mail/i);
  assert.doesNotMatch(auth, /Google|Facebook|Apple|login social/i);
});

test("marca visível usa MotoPombal e o novo wordmark", () => {
  assert.match(auth, /MotoPombal/);
  assert.match(auth, /\/brand\/motopombal-wordmark\.png/);
  assert.doesNotMatch(auth, />MotoVip</);
  assert.match(page, /\/brand\/motopombal-(?:wordmark|badge)\.png/);
});

test("lembrar de mim salva apenas o telefone e pode ser desmarcado", () => {
  assert.match(auth, /REMEMBERED_PHONE_KEY, phone/);
  assert.match(auth, /removeItem\(REMEMBERED_PHONE_KEY\)/);
  assert.doesNotMatch(auth, /setItem\([^\n]*form\.password/);
});

test("cadastro destaca criação, escolhe perfil e pede os campos corretos", () => {
  assert.match(auth, /Ainda não tem conta\?/);
  assert.match(auth, /Criar minha conta/);
  assert.match(auth, /Como você quer usar o/);
  assert.match(auth, /PASSAGEIRO/);
  assert.match(auth, /Quero pedir uma moto/);
  assert.match(auth, /MOTORISTA/);
  assert.match(auth, /Quero fazer corridas/);
  assert.match(auth, /placeholder="Confirmar senha"/);
  assert.match(auth, /placeholder="Placa da moto"/);
  assert.match(auth, /placeholder="Modelo da moto"/);
  assert.match(auth, /placeholder="Cor da moto"/);
  assert.match(auth, /Criar conta de motorista/);
});

test("hero, benefícios e formulário elevado existem só no layout mobile", () => {
  assert.match(auth, /className="auth-hero-benefits"/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.syxp-auth-page \.auth-card \{[\s\S]*?margin: -20px auto/);
  assert.match(css, /\.auth-role-cards > button/);
  assert.match(css, /\.auth-create-account/);
  assert.match(css, /\.auth-header-actions \.gold svg \{ display: block;/);
});

test("seletor de destino reconhece e ordena o catálogo visual da cidade", () => {
  assert.match(page, /const DESTINATION_CITY_CATALOG = \[/);
  assert.match(page, /label: "Terminal Rodoviário"/);
  assert.match(page, /label: "Prefeitura Municipal"/);
  assert.match(page, /label: "Escola Municipal"/);
  assert.match(page, /label: "Godoy Estética"/);
  assert.match(page, /destinationCityLabel\(place\.name\)/);
  assert.match(page, /destination-place-category-\$\{place\.category\}/);
});
