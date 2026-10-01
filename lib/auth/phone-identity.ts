const COUNTRY_CODE = "55";
const INTERNAL_AUTH_DOMAIN = "phone.motovip.invalid";

export class InvalidBrazilianPhoneError extends Error {
  constructor() {
    super("Informe um celular ou telefone brasileiro válido com DDD.");
    this.name = "InvalidBrazilianPhoneError";
  }
}

export function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeBrazilianPhone(value: string) {
  let digits = phoneDigits(value);
  if (digits.startsWith(COUNTRY_CODE) && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(COUNTRY_CODE.length);
  }
  if (digits.length !== 10 && digits.length !== 11) throw new InvalidBrazilianPhoneError();
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99 || /^0/.test(digits.slice(2))) throw new InvalidBrazilianPhoneError();
  return `+${COUNTRY_CODE}${digits}`;
}

export function maskBrazilianPhone(value: string) {
  let digits = phoneDigits(value);
  if (digits.startsWith(COUNTRY_CODE) && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (!digits) return "";
  if (digits.length < 3) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  if (number.length <= 4) return `(${ddd}) ${number}`;
  const split = number.length > 8 ? 5 : 4;
  return `(${ddd}) ${number.slice(0, split)}-${number.slice(split)}`;
}

export function phoneAuthEmail(normalizedPhone: string) {
  const digits = phoneDigits(normalizedPhone);
  return `${digits}@${INTERNAL_AUTH_DOMAIN}`;
}

export function isInternalPhoneEmail(value?: string | null) {
  return Boolean(value?.toLowerCase().endsWith(`@${INTERNAL_AUTH_DOMAIN}`));
}

export function normalizeBrazilianPlate(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 7);
}
