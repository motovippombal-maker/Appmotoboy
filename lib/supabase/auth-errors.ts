type AuthLikeError = { message?: string; code?: string } | null | undefined;

export function friendlyAuthError(error: AuthLikeError) {
  const message = error?.message?.toLowerCase() || "";
  const code = error?.code || "";

  if (
    code === "user_already_exists" ||
    message.includes("already registered") ||
    message.includes("already been registered")
  ) {
    return "Este e-mail já está cadastrado. Entre na sua conta ou recupere a senha.";
  }
  if (
    code === "invalid_credentials" ||
    message.includes("invalid login credentials")
  ) {
    return "Usuário não encontrado ou senha incorreta. Confira os dados e tente novamente.";
  }
  if (
    code === "email_address_invalid" ||
    (message.includes("email address") && message.includes("invalid"))
  )
    return "Informe um endereço de e-mail válido.";
  if (message.includes("email not confirmed")) {
    return "Confirme o e-mail enviado pela Moto SyXp antes de entrar.";
  }
  if (
    message.includes("password") &&
    (message.includes("weak") || message.includes("least"))
  ) {
    return "Use uma senha com pelo menos 8 caracteres.";
  }
  if (code === "same_password")
    return "A nova senha precisa ser diferente da senha atual.";
  if (code === "over_email_send_rate_limit" || message.includes("rate limit")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("connection")
  ) {
    return "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.";
  }
  return (
    error?.message ||
    "Não foi possível concluir o acesso agora. Tente novamente."
  );
}
