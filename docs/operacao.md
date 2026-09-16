# Operação: segurança, observabilidade e custo

## Segurança no consumo das APIs

Todo endpoint de negócio exige JWT válido. Local é HS256 com segredo compartilhado, só para exercitar a API sem subir provedor de identidade. No alvo é RS256 validado contra o JWKS do Identity Platform, com cache das chaves e rotação automática.

A validação confere assinatura, expiração, `issuer` e `audience`. Falha em qualquer uma devolve 401. O `audience` é o item mais esquecido, e é ele que impede que um token emitido para outro serviço da mesma organização seja aceito aqui.

Autorização é por escopo, e os escopos são estreitos de propósito: `entries:write`, `entries:read`, `balance:read`. Um parceiro que só lê relatório recebe um token que não lança nada. Falta de escopo devolve 403 e não 401, porque a distinção diz ao cliente se vale a pena renovar o token.

O comerciante vem do `sub` do token, nunca do corpo ou da query. Essa regra elimina IDOR: não existe caminho no código em que o cliente informe de quem é o dado que está pedindo. Tem teste de API cobrindo isso, com um comerciante tentando ler o saldo do outro.

O resto das camadas, na ordem em que a requisição atravessa:

* Cloud Armor na borda, com regras OWASP, limite de taxa por IP e proteção contra volume anormal.
* API Gateway validando o JWT antes de chegar ao serviço, mais quota por cliente. O serviço valida de novo, porque um dia alguém expõe o Cloud Run sem querer.
* TLS em trânsito, criptografia em repouso no Atlas, segredos no Secret Manager e nunca em variável de ambiente versionada.
* Serviço a serviço por conta de serviço própria, com o mínimo de papéis. O relay só escreve no tópico, o worker só lê.
* Validação de entrada estrita no domínio: tipo, faixa de valor, tamanho de descrição, formato e janela de data. Payload desconhecido é rejeitado.

Para consumo por parceiro externo eu acrescentaria mTLS ou client credentials com certificado, além de allowlist de origem. Não implementei porque não há parceiro externo no escopo.

Sobre dado pessoal: o modelo guarda identificador de comerciante e valores, não guarda CPF, nome ou dado de cartão. Se entrasse, entraria com finalidade declarada, retenção definida e mascaramento no log. O log hoje já não registra corpo de requisição.

## Observabilidade

Os dois serviços expõem `/metrics` no formato Prometheus, além de `/health/live` e `/health/ready`. No alvo, Managed Prometheus coleta e o Cloud Monitoring alerta.

As métricas que eu de fato olharia:

| Métrica | Para quê |
|---|---|
| `entries_recorded_total` | Volume de negócio. Queda abrupta é incidente antes de ser erro |
| `outbox_events_published_total` e `outbox_publish_failures_total` | Saúde do relay |
| Idade do item mais antigo pendente no outbox | Melhor sinal do conjunto. Se crescer, algo entre banco e broker parou |
| `balance_events_processed_total` por resultado | `applied`, `duplicate` e `discarded`. Descartado subindo significa contrato quebrado |
| Idade da mensagem não confirmada mais antiga na subscription `daily-balance` | Distância entre o que foi lançado e o que está no relatório |

Latência e taxa de erro HTTP eu deixo para o Cloud Run e o load balancer, que já medem por requisição. Instrumentar de novo na aplicação seria trabalho duplicado com números que divergem.

Log é JSON estruturado com `traceId`, `merchantId`, `entryId` e `eventId`, o que permite seguir um lançamento do POST até o saldo. Falta propagar `traceparent` nos atributos da mensagem para ter a linha do tempo completa num APM.

### SLOs e alertas

| SLI | Meta | Alerta |
|---|---|---|
| Disponibilidade de escrita em Lançamentos | 99,9% mensal | 5xx acima de 1% por 5 min, com página |
| Latência do POST de lançamento | p95 < 150 ms | p95 acima de 300 ms por 10 min |
| Propagação até o saldo | p95 < 2s | Backlog da subscription acima de 1000 mensagens por 5 min |
| Disponibilidade de leitura no Consolidado | 99,5% mensal | Erro acima de 5% por 10 min |
| Integridade da projeção | zero divergência | Reconciliação diária com diferença, com página |

A reconciliação diária, comparando soma dos lançamentos com saldo consolidado, é o alerta mais importante da lista. Métrica de latência detecta lentidão, só a reconciliação detecta saldo errado.

Runbook, por ordem de probabilidade: outbox acumulando (verificar Pub/Sub e a credencial do relay, o backlog drena sozinho quando volta), backlog da subscription alto (escalar o worker, checar mensagem em nack contínuo), divergência na reconciliação (reconstruir a projeção a partir da coleção `entries`, já que o consumidor é idempotente e reaplicar não duplica).

## Custo

Estimativa mensal em GCP, na ordem de grandeza, para 2.000 comerciantes, cerca de 200 mil lançamentos por dia e o pico de 50 req/s do enunciado. Preço de lista, sem desconto por compromisso de uso.

| Item | Configuração | US$/mês |
|---|---|---|
| Cloud Run (4 serviços) | APIs escalando de zero, relay e worker com CPU sempre alocada | 120 |
| Pub/Sub | Publicação e entrega de ~200 mil mensagens/dia | 15 |
| MongoDB Atlas | 2 clusters M10, um por serviço | 120 |
| Load Balancing e Cloud Armor | Política com regras OWASP | 45 |
| API Gateway | Por chamada | 10 |
| Logging, Monitoring e Trace | Retenção de 30 dias | 50 |
| Secret Manager | | 1 |
| Total | | ~360 |

Sem cluster para manter, a mensageria deixa de ser linha relevante: fica em torno de 4% da conta. Com Managed Kafka no lugar do Pub/Sub, esses US$ 15 virariam algo em torno de US$ 450 e o total passaria de US$ 800, o que é mais do que dobrar a fatura para comprar uma capacidade que este sistema não usa. O raciocínio está em [decisões](decisoes.md).

Outras alavancas, por ordem de retorno: compromisso de uso de 1 ano no Cloud Run (20% a 30%), um cluster Atlas só com dois bancos lógicos em vez de dois clusters (uns US$ 60, ao custo de perder isolamento de falha entre os contextos, que eu só aceitaria em fase inicial), e retenção de log menor com exportação do que interessa para o BigQuery.

Licenças: zero. Node, NestJS, MongoDB e Prometheus são abertos, e o Pub/Sub é serviço gerenciado cobrado por uso. Vale um registro porque costuma aparecer tarde: o MongoDB é SSPL, o que na prática impede oferecer o próprio Mongo como serviço a terceiros. Usá-lo como banco de uma aplicação, self-hosted ou via Atlas, está fora dessa restrição. O que se paga é serviço gerenciado, não licença.

Para comparação, escala dez vezes maior (2 milhões de lançamentos por dia) não multiplica a conta por dez. O Atlas subiria de faixa, Pub/Sub e Cloud Run crescem quase linear com o volume, e a estimativa ficaria entre US$ 1.000 e 1.400. O desenho aguenta esse crescimento sem mudança estrutural: muda número de partição, tamanho de instância e, aí sim, cache compartilhado na leitura.
