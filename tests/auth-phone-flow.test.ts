import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  InvalidBrazilianPhoneError,
  isInternalPhoneEmail,
  maskBrazilianPhone,
  normalizeBrazilianPhone,
  normalizeBrazilianPlate,
  phoneAuthEmail,
} from "../lib/auth/phone-identity";

const source = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

test("telefone brasileiro é normalizado e mascarado sem perder o DDD", () => {
  assert.equal(normalizeBrazilianPhone("(75) 99999-1234"), "+5575999991234");
  assert.equal(normalizeBrazilianPhone("+55 75 99999-1234"), "+5575999991234");
  assert.equal(maskBrazilianPhone("75999991234"), "(75) 99999-1234");
  assert.throws(() => normalizeBrazilianPhone("123"), InvalidBrazilianPhoneError);
});

test("identidade interna é determinística e não aparece como e-mail comum", () => {
  const email = phoneAuthEmail("+5575999991234");
  assert.equal(email, "5575999991234@phone.motovip.invalid");
  assert.equal(isInternalPhoneEmail(email), true);
  assert.equal(isInternalPhoneEmail("cliente@example.com"), false);
});

test("placa aceita padrão antigo e Mercosul após normalização", () => {
  assert.equal(normalizeBrazilianPlate("abc-1234"), "ABC1234");
  assert.equal(normalizeBrazilianPlate("abc1d23"), "ABC1D23");
});

test("cadastro confirma identidade sem enviar e-mail e persiste perfil e moto", async () => {
  const route = await source("app/api/auth/register/route.ts");
  assert.match(route, /auth\.admin\.createUser/);
  assert.match(route, /email_confirm: true/);
  assert.match(route, /phone_confirm: true/);
  assert.match(route, /user_metadata: \{ full_name: input\.fullName\.trim\(\), phone, role: input\.role \}/);
  assert.match(route, /from\("vehicles"\)\.insert/);
  assert.match(route, /PHONE_ALREADY_REGISTERED/);
  assert.doesNotMatch(route, /resetPasswordForEmail|signUp\(/);
});

test("login resolve o telefone e aplica a sessão real do Supabase", async () => {
  const route = await source("app/api/auth/login/route.ts");
  const hook = await source("hooks/use-moto-vip.ts");
  assert.match(route, /findUserEmailByPhone/);
  assert.match(route, /signInWithPassword/);
  assert.match(hook, /publicApi<[\s\S]*?>\("\/api\/auth\/login", \{ phone, password \}\)/);
  assert.match(hook, /supabase\.auth\.setSession/);
});

test("Pix não transmite a identidade interna como e-mail do pagador", async () => {
  const route = await source("app/api/payments/pix/route.ts");
  assert.match(route, /isInternalPhoneEmail\(user\.email\) \? undefined : user\.email/);
});
