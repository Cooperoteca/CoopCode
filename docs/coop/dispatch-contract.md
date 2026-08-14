# Contrato de despacho

**Data:** 2026-08-14
**Aplica-se a:** todo despacho de subagente pelo `rlm` do Prime Agent
**Origem:** §3, §4 e §5 de [`rlm-execution-model.md`](./rlm-execution-model.md)

Este documento tem duas partes. A **Parte A** é o que o orquestrador faz. A
**Parte B** é texto que vai literalmente dentro do prompt de cada filho.

O contrato existe porque o runtime do pi deliberadamente não define "pronto", não
obriga a reportar, não sinaliza progresso e não tem timeout. O doutrinamento
padrão que o pi injeta em todo filho diz *"When you are done, stop calling tools
and state your final answer"* e *"not every message or task needs a reply"* — um
filho que lê, planeja, se considera pronto e vai dormir calado está obedecendo.
A Parte B contradiz isso de propósito.

---

# Parte A — o que o orquestrador faz

## A1. Antes de despachar

- Confirmar que a task está `ready` e que as dependências foram integradas.
- Criar a worktree. **Filho nunca trabalha no checkout principal** — na DEVX-055
  o filho rodou em `C:\Dev2026\agentic-ide` e não havia como isolar o que ele
  tocou.
- Escolher o modelo. O filho **herda o modelo do pai** por padrão. Para um modelo
  menor, use um seletor exato vindo de `await rlm.find_models(...)`; um modelo
  indisponível **faz o spawn falhar**, então tenha um plano: repetir com outro
  seletor, ou omitir `model` e aceitar a herança.

```python
handle = await rlm(prompt_do_filho, name='devx055-worker-a1')
# retorna na admissão: rlm_child_id, name, session_dir, model
# nunca retorna a resposta do filho
```

Registre, para cada filho: `nome`, `task`, `fase`, `prazo`, `última_evidência`.

Depois de despachar filhos independentes, **encerre o turno**. Não fique
aguardando conclusão dentro da mesma volta.

## A2. Ciclo de supervisão

A cada volta, para cada filho vivo:

1. **Chegou relatório?** Processe e avance a fase.
2. **Não chegou e o prazo venceu?** Inspecione com `agent_observe`. Descubra a
   assinatura com `inspect.signature(...)` ou `help(agent_observe)` antes de
   chamar; não invente parâmetros.
3. **Progrediu desde a última olhada?** Estenda o prazo **uma vez** e anote a
   nova evidência. Isto é o que impede matar trabalho legítimo: `agent_observe`
   distingue "pensando há 20 minutos" de "parado há 20 minutos", e nenhum
   timeout sozinho faz essa distinção.
4. **Ocioso, ou repetindo o mesmo passo?** **Uma** cutucada, curta e concreta,
   dizendo o próximo artefato esperado:

```python
await agent_message.send(
    "Escreva os arquivos agora e commite. Não releia o que já leu. "
    "Depois envie o relatório no formato exigido.",
    receiver_role='child', receiver_name=handle['name'])
```

5. **Ocioso de novo depois da cutucada?** Encerre com
   `await rlm.delete_subagent(handle)`, registre onde parou, e decida: reatribuir
   a outro filho ou escalar ao humano. **Não cutuque uma terceira vez** — na
   DEVX-055 a segunda cutucada consumiu a rodada inteira sem produzir arquivo.

Após compactação ou restart do kernel, recupere handles com
`await rlm.list_subagents()`.

## A3. Quando o filho escalona

Responda, ou suba. Se a decisão for de produto e não estiver registrada na spec,
**não invente requisito** — leve ao humano. Se for técnica e você souber, responda
com `receiver_role='child'` e estenda o prazo.

Quando o `agent_observe` mostrar um filho travado que ainda **não** pediu ajuda,
ofereça — não espere o pedido.

## A4. O orquestrador não escreve código de produto

Se começar a editar arquivo da task, virou worker e perdeu a capacidade de
supervisionar. Correções no próprio arranjo de despacho não contam.

---

# Parte B — texto que vai no prompt de cada filho

Copie a partir daqui, substituindo o que está entre `<>`.

---

## Seu papel

Você é **<worker | revisor>** da task **<ID>**, tentativa **<N>**.

Worktree: `<caminho>`. Trabalhe apenas ali.

Leia a spec em `docs/coop/tasks/<ID>.md` e siga a skill correspondente em
`.claude/skills/coop-<worker|reviewer>/`.

## Definição de pronto

Sua task está pronta quando **estes artefatos existirem em disco** — não quando
você achar que entendeu ou implementou o suficiente:

- <artefato 1, por exemplo: um commit em `task/<id>` cujo diff toca apenas
  caminhos de `scope.allow`>
- <artefato 2, por exemplo: `docs/planning/evidence/<ID>-gate.json` válido para
  aquele SHA>
- <artefato 3, se houver fases>

Analisar, ler e planejar **não é entrega**. Se você parar depois de planejar, a
task não avançou.

## Você é obrigado a responder

Sua task exige resposta. O doutrinamento padrão diz que nem toda task precisa de
resposta — **esta precisa**. Não encerre o turno sem enviar o relatório, mesmo
que o desfecho seja fracasso ou bloqueio.

Exatamente uma mensagem, no fim:

```python
await agent_message.send(f"""
STATUS: done | blocked | failed
TASK: <ID>
SHA: <sha do commit, ou "nenhum">
CRITERIOS: 1 ok | 2 ok | 3 nao — <por que>
GATES: <comando>: passou/falhou (<em que sinal você se baseou>)
ARQUIVOS: <caminhos que você tocou>
PROXIMO: <o que falta, ou "nada">
""", receiver_role='parent')
```

Depois de enviar, siga com a limpeza e vá para ocioso normalmente.

## Quando escalonar em vez de decidir

Escalonar é **barato e esperado**. Não é fracasso. Pare e pergunte quando:

- a spec exigir uma decisão de produto que não está registrada nela;
- a correção precisar de arquivo fora de `scope.allow`;
- um gate falhar por causa do ambiente, e não do código;
- <gatilhos específicos da task, vindos de `escalate_when`>.

Envelope obrigatório, uma pergunta por vez:

```python
await agent_message.send(f"""
BLOCKED: <ID>
TENTEI: <o que já foi tentado, concretamente>
EVIDENCIA: <comando + saída relevante>
DECISAO: <a única pergunta que destrava>
OPCOES: <as alternativas que você enxerga, se enxerga>
""", receiver_role='parent')
```

Sem `TENTEI` e `EVIDENCIA` o pai responde no escuro e a rodada se perde.

## Prazo

Você tem **<N> minutos** por fase. Se for estourar, mande um `BLOCKED` dizendo
onde está, em vez de seguir em silêncio. O pai pode estender.

## Regras que valem mais do que terminar

- Não alargue `scope.allow`. Precisou de arquivo fora dele: escalone.
- Não afrouxe asserção de teste para passar. Ajuste a asserção junto com a cópia
  que ela verifica, nunca para aceitar qualquer coisa.
- Nunca escreva valor de chave de API em arquivo, log ou linha de comando.
- `git add` só nos arquivos do escopo. Nunca `-A`. Confira com
  `git status --short` e `git diff --cached --stat` antes de commitar.

## Armadilhas do ambiente

- Cada célula `%%bash` é um subshell descartável: `cd`, `export` e variáveis de
  shell **não** sobrevivem à célula seguinte. Use `%cd <dir>` e
  `os.environ['VAR'] = '...'`, que valem para todas as chamadas seguintes, ou
  mantenha os passos dependentes numa célula só. Se usar `%%bash`, ela tem que
  ser a primeira linha da célula — sem comentário, espaço ou import antes.
- Não instale dependência no kernel IPython para fazer o projeto rodar. Use o
  ambiente e os comandos do próprio projeto.
- O runner do Playwright sai com código diferente de zero por um `EBUSY` no
  `global-teardown` no Windows, **depois** dos testes terem passado. Leia a linha
  `N passed`, e diga no relatório em qual sinal você se baseou.
- A máquina tem 16 GB e satura. Antes de e2e, cheque a memória livre; abaixo de
  6 GB, mande `BLOCKED` em vez de tentar. **Não mate processo do usuário.**
