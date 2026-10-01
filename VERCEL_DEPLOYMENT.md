# Preparação de publicação do MotoPombal

**Caminho principal recomendado:** Next.js nativo na Vercel. O `vercel.json` fixa o preset Next.js, `npm ci` e `npm run build:vercel`; esse build passou nas validações locais. A documentação oficial da Vercel confirma que `buildCommand` no `vercel.json` substitui o `build` padrão do `package.json`.

**Caminho secundário mantido:** Vinext/Cloudflare para desenvolvimento e validação (`npm run build`; `npm run start` inicia o runtime local). Não há comando de publicação Cloudflare homologado nesta etapa. `npm run start:vercel` inicia localmente o build Next. Nenhum desses comandos foi usado para publicar.

**Esta etapa não autoriza deploy, DNS, credenciais reais ou migration no banco real.**

## Configuração do projeto

Ao importar o repositório na Vercel, utilize:

- Framework Preset: `Next.js`;
- Root Directory: `./`;
- Install Command: `npm ci`;
- Build Command: `npm run build:vercel`;
- Output Directory: automático da Vercel; não sobrescrever.

O arquivo `vercel.json` já registra essas decisões. O comando `npm run build` continua reservado ao ambiente Vinext/Cloudflare.

## Variáveis obrigatórias

Cadastre em **Project Settings → Environment Variables**:

| Variável | Escopo | Exposição |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production e Preview | Pública no navegador |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production e Preview | Pública no navegador |
| `SUPABASE_SECRET_KEY` | Production e Preview | Somente servidor |
| `NEXT_PUBLIC_SITE_URL` | Production | Pública no navegador |

`NEXT_PUBLIC_SITE_URL` é a única origem canônica do aplicativo. Deve ser HTTPS, sem caminho, parâmetros ou credenciais. Sem ela, o build local pode ser validado, mas a checagem `npm run check:vercel-env` falha quando a plataforma define `VERCEL_ENV=production`. O metadata canônico só é gerado quando a variável existe; nenhum domínio foi inventado. Redirects de Auth usam a origem efetiva da página, inclusive em Preview, e precisam estar explicitamente autorizados no Supabase.

`SUPABASE_SECRET_KEY` também é a base da chave derivada usada na assinatura HMAC das cotações; não existe outra variável HMAC independente neste projeto. Rotacioná-la afeta assinaturas pendentes e exige coordenação.

Nunca cadastre `SUPABASE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_DISPATCH_SECRET` ou credenciais financeiras com prefixo `NEXT_PUBLIC_`.

Para Preview, prefira um projeto Supabase separado. Se o mesmo projeto for temporariamente utilizado, restrinja o acesso e não teste dados reais de produção em URLs de Preview.

## Variáveis opcionais ou dependentes de homologação

| Recurso | Variáveis |
| --- | --- |
| Rotas OSRM | `ROUTING_BASE_URL` (há fallback público) |
| Web Push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` pública; `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` e `PUSH_DISPATCH_SECRET` somente no servidor |
| Pix | `PIX_PROVIDER` e credenciais server-side exigidas pelo provedor escolhido |

As três variáveis VAPID devem ser configuradas juntas; se estiverem presentes, o segredo do despachante também é obrigatório. Sem essa configuração, a inscrição Push responde `PUSH_NOT_CONFIGURED`. Sem provedor Pix homologado, o Pix continua indisponível e nenhum pagamento é aprovado artificialmente.

`ROUTING_BASE_URL` é opcional e privado do backend; na ausência dele permanece o fallback OSRM público já existente. Credenciais futuras de Pix devem ser definidas somente após escolha do provedor, no servidor.

## Supabase Auth

Depois que a Vercel gerar o domínio, configure no Supabase:

1. **Authentication → URL Configuration → Site URL** com o domínio final HTTPS;
2. URLs de redirecionamento necessárias para o domínio de produção;
3. uma URL de Preview somente se ela for realmente usada para testar autenticação.

Evite curingas amplos em produção. O domínio comercial final deve ser cadastrado de forma explícita.

## Validação antes de publicar

Execute localmente, sem usar credenciais de produção:

```bash
npm run check:vercel-env
npm run lint
npx tsc --noEmit
npm run build
npm run build:vercel
npm run test:production
```

Depois de uma publicação de Preview deliberada em etapa posterior, valide:

1. `/api/health/supabase` responde com o schema pronto;
2. cadastro, login, recuperação de senha e logout;
3. separação das áreas de passageiro, motorista e administrador;
4. criação, aceite e finalização da corrida em duas sessões;
5. instalação do PWA e atualização do service worker em aparelho físico;
6. GPS e permissões em celulares físicos;
7. nenhuma chave administrativa aparece no bundle ou nas respostas da API.

## Ordem obrigatória antes de uma futura publicação

1. Definir domínio HTTPS e cofre de variáveis, sem registrar valores em Git ou chat.
2. Fazer backup verificável e registrar build/deployment anterior.
3. Conferir histórico de migrations do banco; aplicar **ETAPA 7 `20260929100000` antes de ETAPA 8 `20260929110000`**, uma vez cada, apenas após autorização. Não reaplicar migrations cegamente.
4. Validar `npm run check:vercel-env` com `VERCEL_ENV=production`, lint, TypeScript, 25 testes da ETAPA 9, regressões 2–8 e os dois builds.
5. Fazer Preview deliberado em ambiente separado, homologar Supabase Auth, PWA/Push e testes físicos. Só então decidir sobre promoção à produção.

## Recuperação e rollback

- Antes de migrar, guardar backup/restauração testados e identificar a versão anterior do frontend.
- Se o frontend novo falhar, promover novamente o deployment anterior, depois de verificar compatibilidade com o schema já migrado.
- Migrations aplicadas não são revertidas automaticamente nem por exclusão de dados. Corrigir adiante ou restaurar backup sob plano explícito; nunca executar `down`/reset cego no banco real.
- Suspender o agendador Push se houver erro de envio em massa; isso não altera corridas ou pagamentos.

## Publicação pelo GitHub — somente em etapa autorizada

Quando o repositório estiver no GitHub:

1. importe o repositório no painel da Vercel, quando autorizado;
2. confira que a branch de produção é `main`;
3. cadastre as variáveis sem enviar os valores por chat ou commit;
4. faça primeiro um Preview;
5. só promova para produção após os testes acima e o checklist de homologação estar concluído.

## Bloqueios comerciais ainda existentes

Antes de abrir ao público:

- rotacione a chave administrativa do Supabase que já foi compartilhada fora do cofre de segredos;
- configure SMTP próprio;
- configure VAPID e um agendador protegido para a fila Push;
- escolha e homologue um provedor Pix;
- defina domínio final e HTTPS;
- conclua a homologação física de GPS, rede ruim e permissões em celulares reais.
