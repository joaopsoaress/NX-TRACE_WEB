# NX-TRACE

### Analisador comportamental leve de APIs REST

![Versão](https://img.shields.io/badge/vers%C3%A3o-1.0-blue)
![Status](https://img.shields.io/badge/status-em%20desenvolvimento-yellow)
![Python](https://img.shields.io/badge/python-3.8%2B-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/flask-interface%20web-000000?logo=flask&logoColor=white)
![Vercel](https://img.shields.io/badge/deploy-vercel-000000?logo=vercel&logoColor=white)
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
- inspeção de certificados HTTPS.

Alvos externos são permitidos, mas **somente sistemas seus ou para os quais você tenha autorização explícita**. A interface web exige a confirmação de escopo em toda operação.

Na versão web, as requisições partem dos **servidores da Vercel** (não do seu computador). Por isso:

- endereços locais e de rede privada (`localhost`, `127.x`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, etc.) são **bloqueados**, inclusive quando alcançados por redirecionamento. Para testar um serviço local, publique-o ou use um túnel público;
- o alvo verá requisições vindas de IPs da Vercel (se ele tiver firewall ou allowlist, isso importa).

---

## Funcionalidades

- **Varredura sequencial** dos endpoints da lista.
- **Perfilamento de respostas HTTP:** código de status, tempo de resposta e tamanho (leitura limitada a 1 MB por resposta).
- **Detecção de sinais de autenticação** por três critérios independentes: status `401`/`403`, cabeçalho `WWW-Authenticate` e palavras-chave no corpo.
- **Descoberta por wordlist**, com variações estruturais dos caminhos.
- **Extração de JSON** com preservação integral do payload, inclusive aninhado.
- **Backup automático** da lista de endpoints antes de qualquer alteração (os 20 mais recentes).
- **Relatório estruturado** em `.txt` com métricas, indicadores de autenticação, JSON, erros, timeouts e estatísticas.
- **Histórico de relatórios** (até 20) na versão web.
- **Resiliência:** falhas de conexão e timeouts são registrados e a varredura continua.

---

## Interfaces

| Interface | Como usar | Observações |
|---|---|---|
| **CLI** | `nx-trace` | Interativa, no terminal. Grava `report.txt` e `endpoints.txt` na pasta atual. Não mudou. |
| **Web** | Deploy na Vercel | Sem login e sem banco de dados. Lista, backups e relatórios ficam no `localStorage` do navegador. |

As duas interfaces seguem as mesmas regras de análise. A versão web usa o módulo `nx_trace/core.py`, que contém a lógica sem `print` nem `input`.

---

### Dados no navegador

Tudo fica no `localStorage`, por navegador e por usuário. Não há conta nem banco, e o servidor não guarda nada.

| Chave | Conteúdo |
|---|---|
| `nx_endpoints` | lista atual de endpoints (começa com a lista padrão de `nx_trace/endpoints.txt`) |
| `nx_backups` | até 20 backups da lista |
| `nx_reports` / `nx_report_<id>` | índice e conteúdo dos relatórios (até 20) |
| `nx_form` / `nx_state` | campos do formulário (inclusive headers) e tela atual |

Limpar os dados do site apaga o histórico. Se o navegador atingir o limite de armazenamento (cerca de 5 MB), os relatórios mais antigos são descartados.

---

## Estrutura do projeto

```
NX-TRACE/
├── api/
│   └── index.py            # API Flask sem estado (função da Vercel)
├── public/                 # interface web estática
│   ├── index.html
│   ├── script.js
│   └── styles.css
├── nx_trace/
│   ├── scanner.py          # CLI
│   ├── core.py             # lógica reutilizável (usada pela web)
│   └── endpoints.txt       # lista padrão de endpoints
├── requirements.txt        # dependências da função na Vercel
├── vercel.json             # rotas, duração máxima e cabeçalhos de segurança
├── .python-version
└── pyproject.toml
```

---

## API da interface web

Todas as rotas são `POST` com JSON, exceto `defaults`. As que tocam o alvo exigem `scope_confirmed: true`.

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/defaults` | Lista de endpoints e wordlist padrão |
| `POST` | `/api/parse` | Valida o texto de um `.txt` (endpoints ou wordlist) |
| `POST` | `/api/check` | Valida URL, escopo, alvo público, método e headers |
| `POST` | `/api/probe` | Perfila **um** endpoint |
| `POST` | `/api/discover` | Testa as variações de **uma** palavra da wordlist |
| `POST` | `/api/report` | Monta o relatório `.txt` a partir dos resultados |

---

## Limitações e próximos passos

- Recarregar a página durante uma varredura a interrompe (o que já foi concluído não é guardado até o fim ou o cancelamento).
- Cada requisição ao alvo tem timeout de 8 s e a leitura do corpo é limitada a 1 MB; a função da Vercel tem duração máxima de 60 s.
- Os tempos de resposta incluem o trajeto entre a Vercel e o alvo, então diferem dos medidos na sua máquina.
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