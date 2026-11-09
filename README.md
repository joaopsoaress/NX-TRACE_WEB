# NX-TRACE

### Analisador comportamental leve de APIs REST

![Versão](https://img.shields.io/badge/vers%C3%A3o-1.0-blue)
![Status](https://img.shields.io/badge/status-em%20desenvolvimento-yellow)
![Python](https://img.shields.io/badge/python-3.8%2B-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/flask-interface%20web-000000?logo=flask&logoColor=white)
![Interface](https://img.shields.io/badge/interface-CLI%20%2B%20Web-lightgrey)
![Escopo](https://img.shields.io/badge/escopo-n%C3%A3o%20invasivo-success)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-green)

O **NX-TRACE** é uma ferramenta para análise comportamental determinística de endpoints REST em ambientes controlados. Ele inspeciona as respostas HTTP de forma estruturada (latência, tamanho, sinais de autenticação e payloads JSON) e documenta o resultado em um relatório, com foco em **clareza, reprodutibilidade e escopo explícito**.

Projeto acadêmico da **FATEC José Crespo Gonzales** (Análise e Desenvolvimento de Sistemas, Sorocaba – SP).

> **Esta é a primeira versão do projeto e da documentação.** Algumas funcionalidades ainda estão em desenvolvimento (veja [Limitações e próximos passos](#limitações-e-próximos-passos)).

---

## Escopo e uso ético

O NX-TRACE **observa e documenta**. Ele **não** faz:

- exploração de vulnerabilidades;
- ataques de força bruta;
- bypass ou contorno de autenticação;
- fuzzing avançado;
- inspeção de certificados HTTPS;
- varredura externa não autorizada.

Use somente em sistemas seus ou para os quais você tenha **autorização explícita**. O ambiente de testes incluído existe justamente para que os experimentos não dependam de alvos externos.

---

## Funcionalidades

- **Varredura sequencial** dos endpoints listados em `endpoints.txt`.
- **Perfilamento de respostas HTTP:** código de status, tempo de resposta e tamanho.
- **Detecção de sinais de autenticação** por três critérios independentes: status `401`/`403`, cabeçalho `WWW-Authenticate` e palavras-chave no corpo.
- **Descoberta por wordlist**, com variações estruturais dos caminhos.
- **Extração de JSON** com preservação integral do payload, inclusive aninhado.
- **Backup automático** do `endpoints.txt` antes de qualquer alteração.
- **Relatório estruturado** em `.txt` com métricas, indicadores de autenticação, JSON, erros, timeouts e estatísticas.
- **Resiliência:** falhas de conexão e timeouts são registrados e a varredura continua.
- **Ambiente local de testes** (`test_server.py`) com respostas públicas, autenticadas, proibidas, JSON e latência artificial.

---

## Interfaces

| Interface | Como iniciar | Observações |
|---|---|---|
| **CLI** | `nx-trace` | Interativa, no terminal. Grava `report.txt` e `endpoints.txt` na pasta atual. |
| **Web** | `python -m nx_trace.web.app` | Local, sem login, em `http://127.0.0.1:5000`. Grava em `data/`. |

As duas interfaces seguem as mesmas regras de análise. A versão web usa o módulo `nx_trace/core.py`, que contém a lógica sem `print` nem `input`.

---

## Instalação

**Requisitos:** Python 3.8 ou superior.

```bash
git clone <url-do-repositorio>
cd NX-TRACE
pip install -e .
```

Isso instala as dependências (`requests` e `flask`) e o comando `nx-trace`.

---

## Uso

### 1. Ambiente de testes

Em um terminal, suba o servidor de testes (porta 8000):

```bash
python test_server.py
```

### 2. Interface web

Em outro terminal:

```bash
python -m nx_trace.web.app
```

Abra `http://127.0.0.1:5000` e use o alvo `http://127.0.0.1:8000`.

Fluxo das telas:

1. **Nova varredura:** informe URL, método e headers; escolha a lista de endpoints (padrão ou upload `.txt`); opcionalmente ative a descoberta por wordlist; confirme o escopo autorizado.
2. **Revisão da descoberta** (se ativada): marque os endpoints encontrados que deseja adicionar. O backup é criado antes de alterar a lista.
3. **Execução:** acompanhe o progresso, a tabela e o registro em tempo real; é possível cancelar.
4. **Relatório:** resumo, filtros, detalhe por endpoint (sinais de autenticação e JSON completo) e exportação em `.txt`.
5. **Endpoints e backups:** edite a lista, envie um novo `.txt` e restaure backups.

Ao recarregar a página, a interface mantém o que você preencheu (URL, método, headers e descoberta), a tela em que estava e a última varredura (inclusive uma em andamento). Isso fica no `localStorage` do navegador. Não são mantidos: a confirmação de escopo, que deve ser marcada a cada varredura, e os arquivos `.txt` selecionados para upload, que precisam ser escolhidos de novo.

### 3. CLI

```bash
nx-trace
```

Siga as instruções no terminal. Ao final, o relatório é gravado em `report.txt`.

---

## Estrutura do projeto

```
NX-TRACE/
├── nx_trace/
│   ├── scanner.py          # CLI
│   ├── core.py             # lógica reutilizável (usada pela web)
│   ├── endpoints.txt       # lista padrão de endpoints
│   └── web/
│       ├── app.py          # backend Flask (API JSON)
│       └── static/         # index.html, styles.css, script.js
├── test_server.py          # ambiente local de testes
├── data/                   # criado pela interface web (não versionado)
│   ├── endpoints.txt
│   ├── backups/
│   └── reports/
└── pyproject.toml
```

Para mudar a pasta de dados da web, defina a variável de ambiente `NX_TRACE_DATA`.

---

## API da interface web

| Método | Rota | Função |
|---|---|---|
| `GET` / `PUT` | `/api/endpoints` | Lê ou grava a lista (com backup) |
| `POST` | `/api/endpoints/restore` | Restaura um backup |
| `POST` | `/api/scans` | Inicia uma varredura |
| `POST` | `/api/discover` | Inicia a descoberta por wordlist |
| `GET` | `/api/jobs/<id>?since=N` | Progresso e eventos novos |
| `POST` | `/api/jobs/<id>/cancel` | Cancela a operação |
| `GET` | `/api/jobs/<id>/report` | Baixa o `report.txt` |

O servidor escuta apenas em `127.0.0.1` e exige a confirmação de escopo em toda varredura.

---

## Limitações e próximos passos

- Executa **uma operação por vez**.
- Se o servidor for reiniciado, a varredura da tela é perdida (o `.txt` continua em `data/reports/`).
- A tela de **histórico** de relatórios ainda não existe (os arquivos já ficam salvos em `data/reports/`).
- Métodos suportados: `GET`, `HEAD` e `OPTIONS` (com `HEAD` não há corpo para analisar).
- A detecção por palavra-chave é simples e pode gerar falsos positivos (por exemplo, "auth" dentro de "author").
- Previstos para versões futuras: varredura concorrente, suporte a autenticação por token e exportação em JSON/HTML.

---

## Autores

- João Pedro Soares da Rosa Oliveira
- Pedro José Vanzella
- Reynaldo José Pedroso Ramos Neto

FATEC José Crespo Gonzales – Análise e Desenvolvimento de Sistemas – Sorocaba, SP, 2026.

## Licença

Distribuído sob a licença MIT. Veja o arquivo [LICENCE](LICENCE).

A versão em inglês do README original está em [README.en.md](README.en.md).