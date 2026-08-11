# Subagent: provider-screen — Fase 3b (cadastro de provider/modelo pi)

- Repo: C:\Dev2026\agentic-ide (fork CoopCode), branch spike/pi-terminal-panel
- App: apps/desktop/orca
- Plataforma usada para testes: Windows ARM64 (runner vitest via node.exe)
- Data: 2026-08-11 18:41:13

## Arquivos criados (todos novos, sob ownership)

| Arquivo | Tipo |
| --- | --- |
| src/main/pi-rpc/extension-writer.ts | Main: validacao pura + geracao do .ts + escrita no dir de extensoes |
| src/main/pi-rpc/extension-writer.test.ts | Vitest (main) |
| src/main/pi-rpc/extensions-ipc.ts | Main: registerPiExtensionsIpcHandlers() gated por isTrustedUIRenderer |
| src/renderer/src/components/pi-providers/PiProviderForm.tsx | Renderer: formulario principal da aba |
| src/renderer/src/components/pi-providers/PiProviderForm.test.tsx | Vitest (renderer, happy-dom) |
| src/renderer/src/components/pi-providers/provider-form-model.ts | Renderer: validacao pura + shaping do spec |
| src/renderer/src/components/pi-providers/provider-form-model.test.ts | Vitest (renderer) |

Nenhum arquivo sob ownership de outro agente foi tocado (flex-shell/*, pi-chat/*,
pi-history/*, preload, src/shared/pi-rpc.ts, src/main/index.ts).

## Decisoes

1. Escritor revalida tudo no main (defense in depth). validateProviderExtensionSpec roda
   antes de escrever: slug seguro do providerId (regex ^[A-Za-z0-9][A-Za-z0-9_-]*$, que
   sozinha rejeita ../, barras, backslashes e '..'), baseUrl http(s), >=1 modelo, numeros
   inteiros positivos, e a credencial nao pode parecer chave (sk-... OU 40+ chars sem espaco).
   Alem disso a credencial valida e' so env var (^[A-Za-z_][A-Za-z0-9_]*$) ou '!comando'.
   Sempre retorna PiExtensionWriteResult, nunca lanca para o renderer.
2. Formato do arquivo gerado = clinepass.ts (~/.prime/agent/extensions/clinepass.ts):
   'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";' +
   'export default function (pi)' + 'pi.registerProvider(...)', com
   cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, input: ["text"], e um comentario no
   arquivo explicando que apiKey e' NOME de env var ou '!comando' (referenciando
   packages/coding-agent/src/core/resolve-config-value.ts e a pegadinha do 401). Valores de
   string escapados com JSON.stringify para impedir fuga de aspas/backslashes do input.
3. Credencial nunca e' chave crua (regra de ouro). Form e main recusam qualquer valor que
   pareca chave, com mensagem: a chave vai por env var, '!comando' ou '/login' dentro do pi.
4. Aviso persistente da pegadinha do pi: se a env var nao existir, o pi usa a propria string
   como chave e o provider responde 401 — parece chave invalida quando e' config invalida.
5. Pos-save: extensoes so sao lidas no startup do pi; botao 'Start new session' envia
   { type:'new_session' } via window.api.piRpc.send.
6. Mensagens do main sem i18n (defesa em profundidade): strings em ingles internas no
   escritor; o form traduz os seus proprios codigos de erro antes de enviar.
7. i18n no form: mapa ERROR_MESSAGE com { key, fallback }, resolvido via translate apenas no
   render (nao no modulo-load), para nao depender do estado do i18next na importacao.
8. Duas constantes de suporte (TAB, NL) no escritor para gerar TS indentado por tabs, igual
   ao clinepass.ts.

## Chaves i18n criadas (chave -> fallback em ingles)

Namespace base: auto.components.pi.providers.PiProviderForm.

| Chave | Fallback |
| --- | --- |
| .title | Add a pi provider |
| .description | Register an OpenAI-compatible provider. The API key is referenced by environment variable or !command — you never paste the key here. |
| .providerId | Provider id |
| .providerIdPlaceholder | e.g. clinepass |
| .providerName | Display name |
| .providerNamePlaceholder | e.g. ClinePass |
| .baseUrl | Base URL |
| .baseUrlPlaceholder | https://api.example.com/v1 |
| .api | API type |
| .apiPlaceholder | openai-completions |
| .credential | Credential |
| .credentialPlaceholder | ENV_VAR_NAME or !command-that-prints-the-key |
| .credentialHint | Enter the environment variable name (e.g. CLINEPASS_API_KEY) or a !command that prints the key on stdout. |
| .credentialWarning | Pitfall: if that environment variable does not exist, pi uses the string itself as the key and the provider answers 401 — that looks like an invalid key but is actually misconfiguration. |
| .models | Models |
| .modelsHint | At least one model is required. |
| .modelId | Model id |
| .modelIdPlaceholder | e.g. cline-pass/deepseek-v4-flash |
| .modelName | Model name |
| .modelNamePlaceholder | e.g. DeepSeek V4 Flash |
| .contextWindow | Context window |
| .maxTokens | Max tokens |
| .reasoning | Supports extended thinking (reasoning) |
| .addModel | Add model |
| .removeModel | Remove model |
| .save | Save provider |
| .saving | Saving… |
| .savedTitle | Provider saved |
| .savedDescription | Extensions are loaded when pi starts, so this only applies to new sessions. Start a new session now to pick up the provider. |
| .newSession | Start new session |
| .newSessionRequested | New session requested |
| .saveFailed | Could not save provider |
| .errorProviderIdRequired | Provider id is required |
| .errorProviderIdSlug | Use only letters, digits, dashes and underscores — safe for a file name |
| .errorProviderNameRequired | Display name is required |
| .errorBaseUrlRequired | Base URL is required |
| .errorBaseUrlInvalid | Enter a valid http(s) URL, e.g. https://api.example.com/v1 |
| .errorApiRequired | API type is required |
| .errorCredentialRequired | Enter the environment variable name or !command that holds the key |
| .errorCredentialLooksLikeKey | That looks like a raw API key — the key goes in an environment variable, a !command, or /login inside pi |
| .errorCredentialInvalidRef | Use an environment variable name (like CLINEPASS_API_KEY) or a !command that prints the key |
| .errorModelIdRequired | Model id is required |
| .errorModelNameRequired | Model name is required |
| .errorContextWindowPositive | Context window must be a positive integer |
| .errorMaxTokensPositive | Max tokens must be a positive integer |
| .errorModelsRequired | Add at least one model |

Observacao: strings fixas do proprio main (extension-writer.ts) sao mensagens internas em
ingles, sem i18n (so aparecem se a defesa em profundidade disparar). A unica string crua
exibida e' o campo error do PiExtensionWriteResult apensado ao .saveFailed.

## Testes escritos

Main - src/main/pi-rpc/extension-writer.test.ts (19 testes):
- looksLikeRawApiKey: sk-, 40+ chars sem espaco; aceita env var e '!comando'.
- validateProviderExtensionSpec: aceita spec valido; rejeita ../../evil/a/b/.., slugs
  inseguros (a b, a.b, ''); rejeita credencial sk-... e 40+; rejeita credencial que nao e'
  env var nem '!comando'; rejeita baseUrl invalida; rejeita models vazio; rejeita numeros
  invalidos (0, negativos, 1.5).
- buildProviderExtensionContent: contem registerProvider("acme", {, name/baseUrl/api, ids e
  numeros dos modelos; embeddings da credencial (env var e '!comando') sem chave crua; escape
  de aspas.
- writeProviderExtension: escreve <dir>/<providerId>.ts e retorna o path; cria dirs
  aninhados; retorna ok:false para slug invalido sem escrever e para credencial crua.

Renderer - provider-form-model.test.ts (13 testes):
- Slug, credencial (looksLikeKey, invalidRef), form valido, path-traversal, baseUrl,
  models.required, erros por-modelo, shaping do spec.

Renderer - PiProviderForm.test.tsx (3 testes):
- credencial crua => mensagem visivel e writeProvider NAO chamado;
- hint persistente da pegadinha do 401 visivel;
- save valido com env var chama writeProvider com o spec certo e oferece 'Start new session'
  que envia { type:'new_session' }.

## Resultados vitest (apenas meus arquivos)

Comandos (a partir de apps/desktop/orca; runner nativo via node do ambiente):
- Main: node node_modules/vitest/vitest.mjs run --config config/vitest.main.config.ts src/main/pi-rpc/extension-writer.test.ts
  -> 19 passed, 0 falhou (exit 0).
- Renderer: node node_modules/vitest/vitest.mjs run --config config/vitest.renderer.config.ts src/renderer/src/components/pi-providers/
  -> 16 passed, 0 falhou (13 model + 3 componente) (exit 0).

O runner nativo funcionou; nenhuma falha por ambiente. Gates globais (test:main/renderer
completos, typecheck, lint) NAO foram executados — conforme as regras o pai os roda.

## Observacoes para o pai

- extensions-ipc.ts expoe registerPiExtensionsIpcHandlers() (sem args, sem retorno) para o
  wiring em src/main/index.ts. Nao toquei nesse arquivo.
- O componente exporta PiProviderForm (autocontido, sem props) de
  src/renderer/src/components/pi-providers/PiProviderForm.tsx; o flex-shell ja reserva o
  componente providers (SHELL_TAB_COMPONENT.providers / SHELL_TAB_ID.providers).
- Direcao de i18n: adicionar nos 5 locales os pares da tabela acima (chave -> fallback).


## Nota sobre o envio ao pai (agent_message)

A tentativa de `await agent_message.send(... , receiver_role='parent')` falhou com erro de
ambiente do daemon de mensagens: "No API key found for kimi-coding" (falta /login da
credencial do modelo de mensageria). Nao e' um erro de codigo: o relatorio em disco
(este arquivo) e' a prova obrigatoria e foi gravado com sucesso.
