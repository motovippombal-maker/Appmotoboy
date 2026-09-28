# Publicação do Moto VIP na Vercel

Este projeto está preparado para usar o Next.js nativo na Vercel, sem remover o build existente do Vinext/Cloudflare.

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

Nunca cadastre `SUPABASE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_DISPATCH_SECRET` ou credenciais financeiras com prefixo `NEXT_PUBLIC_`.

Para Preview, prefira um projeto Supabase separado. Se o mesmo projeto for temporariamente utilizado, restrinja o acesso e não teste dados reais de produção em URLs de Preview.

## Variáveis opcionais ou dependentes de homologação

| Recurso | Variáveis |
| --- | --- |
| Rotas OSRM | `ROUTING_BASE_URL` (há fallback público) |
| Web Push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET` |
| Pix | `PIX_PROVIDER` e credenciais server-side exigidas pelo provedor escolhido |

As três variáveis VAPID devem ser configuradas juntas. Sem provedor Pix homologado, a interface continuará informando que o provedor não está configurado e nenhum pagamento será aprovado artificialmente.

## Supabase Auth

Depois que a Vercel gerar o domínio, configure no Supabase:

1. **Authentication → URL Configuration → Site URL** com o domínio final HTTPS;
2. URLs de redirecionamento necessárias para o domínio de produção;
3. uma URL de Preview somente se ela for realmente usada para testar autenticação.

Evite curingas amplos em produção. O domínio comercial final deve ser cadastrado de forma explícita.

## Validação antes de publicar

Execute localmente:

```bash
npm run check:vercel-env
npm run lint
npm run build:vercel
```

Depois do primeiro Preview, valide:

1. `/api/health/supabase` responde com o schema pronto;
2. cadastro, login, recuperação de senha e logout;
3. separação das áreas de passageiro, motorista e administrador;
4. criação, aceite e finalização da corrida em duas sessões;
5. instalação do PWA e atualização do service worker;
6. GPS e permissões em celulares físicos;
7. nenhuma chave administrativa aparece no bundle ou nas respostas da API.

## Publicação pelo GitHub

Quando o repositório estiver no GitHub:

1. importe o repositório no painel da Vercel;
2. confira que a branch de produção é `main`;
3. cadastre as variáveis sem enviar os valores por chat ou commit;
4. faça primeiro um Preview;
5. só promova para produção após os testes acima.

## Bloqueios comerciais ainda existentes

Antes de abrir ao público:

- rotacione a chave administrativa do Supabase que já foi compartilhada fora do cofre de segredos;
- configure SMTP próprio;
- configure VAPID e um agendador protegido para a fila Push;
- escolha e homologue um provedor Pix;
- defina domínio final e HTTPS;
- conclua a homologação física de GPS, rede ruim e permissões em celulares reais.
