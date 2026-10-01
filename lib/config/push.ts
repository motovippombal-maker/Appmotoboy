import { configuredSecret } from "@/lib/config/public-site-url.mjs";

export function pushConfiguration(env: Record<string, string | undefined> = process.env) {
  const values = {
    publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim(),
    privateKey: env.VAPID_PRIVATE_KEY?.trim(),
    subject: env.VAPID_SUBJECT?.trim(),
  };
  const missing = [
    !configuredSecret(values.publicKey) && "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    !configuredSecret(values.privateKey) && "VAPID_PRIVATE_KEY",
    (!values.subject || /SEU-DOMINIO|example/i.test(values.subject)) && "VAPID_SUBJECT",
    !configuredSecret(env.PUSH_DISPATCH_SECRET) && "PUSH_DISPATCH_SECRET",
  ].filter((name): name is string => Boolean(name));
  if (values.subject && !values.subject.startsWith("mailto:") && !values.subject.startsWith("https://"))
    missing.push("VAPID_SUBJECT (formato)");
  return { configured: missing.length === 0, missing, values };
}
