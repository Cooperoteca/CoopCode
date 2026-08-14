# Modelo de execução com subagentes (RLM) — proposta

**Data:** 2026-08-14
**Estado:** proposta, não implementada
**Origem:** a DEVX-055 rodou 14 horas e produziu zero arquivos. O diagnóstico
abaixo é a razão de existir deste documento.

---

## 1. O que o runtime garante, e o que ele deliberadamente não garante

Apurado em `prime-agent/packages/coding-agent/src/core/prompts/rlm.ts`, não em
suposição.

| Mecanismo | Contrato real |
|---|---|
| `await rlm('task', name='x')` | Retorna **na admissão**, com `rlm_child_id`, `name`, `session_dir`, `model`. Nunca retorna a resposta do filho |
| Resposta do filho | `await agent_message.send(msg, receiver_role='parent')` — explícita, iniciativa do filho |
| Follow-up do pai | `agent_message.send(..., receiver_role='child', receiver_name=nome)` |
| Modelo do filho | Herda o do pai. Outro modelo exige seletor exato de `rlm.find_models()`; **modelo indisponível faz o spawn falhar** |
| Inspeção | `agent_observe` — transcrição limitada, só de pai, irmãos e filhos diretos |
| Recuperar handles | `rlm.list_subagents()` — necessário após compactação ou restart do kernel |
| Limpeza | `rlm.delete_subagent(child)` |
| Alcance de mensagem | Pai, irmãos e filhos diretos. Mais fundo relaia pelo intermediário |

E o que **não** existe:

- Nenhuma definição de "pronto". O filho decide sozinho quando parou.
- Nenhuma obrigação de reportar. O doutrinamento diz literalmente *"not every
  message or task needs a reply"*.
- Nenhum sinal de progresso. **Silêncio é indistinguível de trabalho.**
- Nenhum timeout. Um filho ocioso e um filho ocupado têm a mesma aparência.

Essas quatro ausências são o framework. Não são defeito do pi — são a fronteira
onde ele espera que a aplicação decida.

---

## 2. Papéis

Quatro, sendo que o quarto não é um agente.

### Orquestrador — modelo grande, sessão de topo

Dono da fila e das decisões. **Nunca escreve código de produto.** Se ele começa a
editar arquivo, virou worker e perdeu a capacidade de supervisionar.

Responsabilidades:
- Selecionar a próxima task elegível e verificar dependências.
- Despachar com contrato de conclusão explícito (§3).
- Supervisionar por relógio, não por fé (§4).
- Responder a escalonamento (§5) ou repassar ao humano.
- Decidir aceite, retrabalho ou bloqueio a partir do parecer do revisor.
- Integrar, ou delegar integração.

### Worker — modelo menor, um por tentativa

Implementa **uma** task, numa worktree própria. Entrega um SHA.

- Roda os gates declarados enquanto itera (precisa deles para saber se avançou).
- Escreve o artefato de evidência ligado ao SHA.
- Escalona em vez de decidir quando a spec for ambígua.
- **Termina obrigatoriamente com um relatório** (§3), mesmo quando falha.

### Revisor — modelo menor, sessão independente

Lê a spec e o diff completo. Não edita nada.

- **Re-roda os gates no SHA entregue**, por conta própria. É aqui que mora a
  independência: o worker rodar os próprios gates é autocertificação.
- Emite veredito único: `accept`, `rework` com achados numerados, ou `escalate`.
- Revisa contra os critérios, não contra o resumo do worker.

### Retrabalho — não é papel, é transição

O worker reentra na mesma task com os achados do revisor, como tentativa N+1.
Um worker novo perderia o contexto de por que a primeira tentativa foi assim, e
tende a refazer o mesmo caminho.

**Sobre um papel separado de teste:** considerado e recusado. O worker precisa
rodar gates para iterar, e o revisor os re-roda para conferir. Um terceiro agente
entre os dois não acrescenta verificação — acrescenta handoff. O que já garante
integridade é o `validate-gate-artifact.mjs`, que amarra evidência ao SHA.

---

## 3. Contrato de conclusão — o que faltava

Todo despacho carrega, obrigatoriamente:

**Definição de pronto em artefatos, nunca em atividades.**
Não "implemente o writer". Sim: *"existe um commit em `task/devx-055` cujo diff
toca apenas os caminhos de `scope.allow`, e existe
`docs/planning/evidence/DEVX-055-gate.json` válido para esse SHA."*
Um filho não consegue julgar "implementei o suficiente"; consegue julgar se um
arquivo existe.

**Relatório obrigatório, exatamente um, em qualquer desfecho.**

```
await agent_message.send(f"""
STATUS: done | blocked | failed
TASK: DEVX-055
SHA: <sha do commit, ou "nenhum">
CRITERIOS: 1 ok | 2 ok | 3 nao — <por que>
GATES: <comando>: passou/falhou (<sinal em que me baseei>)
ARQUIVOS: <caminhos tocados>
PROXIMO: <o que falta, ou "nada">
""", receiver_role='parent')
```

Regra explícita no prompt do filho, porque ela contradiz o doutrinamento padrão:
*"Sua task exige resposta. Analisar e planejar não é entrega. Não encerre o turno
sem enviar o relatório, mesmo que o desfecho seja fracasso."*

**Fases com artefato cada uma.**
Task longa vira fases, cada uma terminando num arquivo em disco. Fase sem
artefato é fase que o pai não consegue verificar sem acreditar.

---

## 4. Supervisão — silêncio não é progresso

O orquestrador nunca espera indefinidamente. Por filho despachado ele mantém
`{nome, task, fase, prazo, última_evidência}` e, a cada ciclo:

1. Chegou relatório? Processa.
2. Não chegou e o prazo venceu? `agent_observe` no filho.
3. Progrediu desde a última olhada? Estende o prazo uma vez e registra.
4. Ocioso, ou repetindo? **Uma** cutucada com instrução concreta e curta.
5. Ocioso de novo depois da cutucada? Encerra o filho, registra o ponto de parada
   e decide: reatribuir ou escalar ao humano.

Foi exatamente o passo 4 que o orquestrador de ontem executou por conta própria —
corretamente, mas por improviso. Virar protocolo é a diferença entre acertar uma
vez e acertar sempre.

O passo 3 é o que evita matar trabalho legítimo: `agent_observe` distingue
"pensando há 20 minutos" de "parado há 20 minutos", e nenhum timeout sozinho faz
isso.

---

## 5. Escalonamento — o pedido de ajuda ao modelo maior

Nativo: é só uma mensagem ao pai. O que falta é ser **nomeado**, para ser usado.

Envelope obrigatório:

```
await agent_message.send(f"""
BLOCKED: DEVX-055
TENTEI: <o que já foi tentado, concretamente>
EVIDENCIA: <comando + saída relevante>
DECISAO: <a única pergunta que destrava>
OPCOES: <as alternativas que enxergo, se enxergo>
""", receiver_role='parent')
```

Três regras que fazem funcionar:

- **Escalonar é barato e esperado.** Uma task com critério "se X for ambíguo,
  escalone em vez de decidir" produz melhor resultado que uma que exige adivinhar.
- **Uma pergunta por vez, com o que já foi tentado.** Sem isso o pai responde no
  escuro e a rodada se perde.
- **O pai responde ou sobe.** Se a decisão for de produto, vai ao humano — não é
  o orquestrador que inventa requisito.

O caminho inverso também vale: quando o orquestrador vê o filho travado por
`agent_observe`, ele **oferece** ajuda em vez de esperar o pedido.

---

## 6. Onde o framework mora

Duas camadas, e a escolha importa.

**`.claude/skills/coop-*`** — já existem, são para o Claude Code, definem o ciclo
(spec, dispatcher, worker, reviewer, integrator). Continuam sendo a definição
processual.

**Continual harness do pi** — `rlm.harness.create_subagent(...)`. Especificações
de delegação **persistidas**, que o pi renderiza no system prompt como um menu que
o modelo escolhe, na mesma ordem que a ferramenta Agent do Claude Code usa
(`system-prompt.ts:127`). Com `global_=True` sobrevivem entre sessões, e
`refine.run()` promove padrão repetido a spec reutilizável automaticamente.

**A proposta é que os papéis do §2 sejam subagent specs do harness**, não prompts
em prosa copiados a cada despacho. Motivos: entram no prompt sem alguém lembrar
de colar, versionam num lugar só, e o `refine` os melhora a partir de falhas
observadas. Um framework em prosa ignora o mecanismo que o pi já tem para isso.

---

## 7. O que muda no formato de task

As tasks existentes (`docs/coop/task-spec-v1.md`) continuam válidas. Acrescenta-se
um bloco:

```json
"execution": {
  "phases": [
    {"name": "implement", "role": "worker", "artifact": "commit em task/<id>"},
    {"name": "evidence",  "role": "worker", "artifact": "docs/planning/evidence/<ID>-gate.json"},
    {"name": "review",    "role": "reviewer", "artifact": "secao ## Review no arquivo da task"}
  ],
  "escalate_when": [
    "a spec exige decisao de produto nao registrada",
    "a correcao precisa de arquivo fora de scope.allow",
    "um gate falha por causa do ambiente, nao do codigo"
  ],
  "deadline_minutes_per_phase": 45
}
```

`escalate_when` é o campo que mais muda comportamento: transforma "pare e
reporte" de conselho genérico em gatilho verificável, e o revisor pode conferir
se um escalonamento devido deixou de acontecer.

---

## 8. Ordem de implantação

Duas faixas paralelas, e uma peça que espera evidência. Não são cinco degraus:
uma rodada de validação custa cerca de 14 horas de relógio, e encadear cinco
delas para validar texto é desperdício.

### Faixa A — o contrato de despacho, agora

Itens §3, §4 e §5 **juntos**. Não são três mudanças: são três seções do mesmo
artefato, sem código, sem gate, sem integração. Consolidados em
[`dispatch-contract.md`](./dispatch-contract.md).

Empacotá-los não atrapalha o diagnóstico, porque falham com sintomas distintos e
distinguíveis na transcrição:

| Item | Como a falha aparece |
|---|---|
| §3 contrato de conclusão | o filho vai dormir sem relatar |
| §4 supervisão por prazo | o pai espera indefinidamente e não detecta |
| §5 envelope de escalonamento | o filho adivinha em vez de perguntar |

### Faixa B — o bloco `execution`, em paralelo

Item §7. É código: exige alterar `docs/coop/schemas/task-spec-v1.schema.json`,
senão toda task passa a falhar em `validate-task.mjs`. Não depende da faixa A nem
ela dele. Deve virar task própria.

### Depois, com evidência — papéis no harness

Item §6. A espera aqui não é prudência genérica. `global_=True` grava estado que
entra no system prompt de **toda sessão futura**, sem passar por revisão. É a
única peça persistente e global da proposta — as outras vivem no prompt de um
despacho e morrem com ele. Um papel mal especificado ali degrada tudo em
silêncio.

Persistir no harness só depois que a faixa A tiver funcionado numa task real, e
de preferência deixando `refine.run()` promover o padrão já validado em vez de
escrevê-lo à mão.

---

## 9. Como saber se funcionou

O teste é a própria DEVX-055, redespachada: um worker que escreve código, roda
gates, commita e reporta sem cutucada humana; um revisor que re-roda os gates e
emite veredito; e, se travar, um escalonamento com envelope em vez de silêncio de
14 horas.

Critério de fracasso honesto: se o filho continuar encerrando o turno sem
reportar mesmo com o contrato explícito, o problema não está no framework — está
no modelo escolhido para o papel, e a resposta é `rlm.find_models()`, não mais
prosa no prompt.
