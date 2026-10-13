# EggHop Jogadores — NOVO (projeto limpo)

Este ZIP é o site dos jogadores. Seu painel de administrador atual continua separado.

## Publicar sem misturar pastas

1. Extraia o ZIP e abra a pasta extraída. A raiz tem `netlify.toml`, `package.json`, `public`, `netlify` e `scripts`.
2. Crie um NOVO repositório GitHub, ex.: `EggHop-Jogadores-Novo`.
3. Faça upload dos arquivos e pastas **de dentro da pasta extraída** para a **raiz do repositório**, sem criar outra pasta envolvendo tudo.
4. Na Netlify, escolha **Add new project → Import from Git** e selecione o novo repositório. Não use Netlify Drop, porque o acesso usa funções.
5. Configuração: Base directory vazio; Package directory vazio; Build command `node scripts/check.mjs`; Publish directory `public`; Functions directory `netlify/functions`. O `netlify.toml` já traz isso.
6. Em Environment variables crie:
   - `SESSION_SECRET`: chave **nova, aleatória e exclusiva** de pelo menos 32 caracteres. Não use exemplos publicados ou a chave do site antigo.
   - `ADMIN_BRIDGE_SECRET`: **exatamente a mesma chave** usada pelo seu painel administrador atual.
7. Faça o deploy até aparecer **Published** e teste `https://NOVO-SITE.netlify.app/.netlify/functions/api?route=status`, que deve mostrar `{"status":"new"}` para um navegador novo.
8. Na Netlify do **ADMINISTRADOR ANTIGO**, mude SOMENTE `PLAYER_SITE_URL` para `https://NOVO-SITE.netlify.app/` (com barra no fim). Confira que o `ADMIN_BRIDGE_SECRET` é igual nos dois. Depois faça um novo deploy do admin.
9. No site novo, solicite nick, envie o código pelo TikTok e aprove no painel administrador atual.

**Importante:** as aprovações do site antigo NÃO são transferidas automaticamente ao novo; as pessoas terão de solicitar e ser aprovadas novamente. As funções do site novo armazenam seus próprios pedidos no Netlify Blobs. Não apague o antigo até confirmar que tudo funciona.

## Melhorias

- O código nunca reabre a tela de verificação depois de receber status `approved` nesta visita.
- Erro na busca de servidores não dispara logout visual; a API continua exigindo autorização para cada consulta.
- Durante um bloqueio pelo administrador, novas consultas são negadas imediatamente. A tela já aberta deixa de exibir acesso após recarregar a página.
- O site exibe `ROUBE UM OVO · NOVO` no cabeçalho para identificar o deploy.

## Limitações

Um nick do Roblox não comprova identidade. O sistema vincula a aprovação ao cookie do navegador usado. O Roblox pode limitar consultas ou impedir entrada na sala exata. O site não solicita senha Roblox. O funcionamento com Roblox/Netlify precisa ser testado após publicar.

Não exponha os segredos em arquivos do GitHub, mensagens ou prints.
