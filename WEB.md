# NX-TRACE – Interface web

Interface local (127.0.0.1) sobre o mesmo núcleo de análise do CLI. Sem login.

## Executar
    pip install requests flask
    python test_server.py          # terminal 1: ambiente de testes (porta 8000)
    python -m nx_trace.web.app     # terminal 2: interface (http://127.0.0.1:5000)

Na tela, use o alvo `http://127.0.0.1:8000`.

## Estrutura
- `nx_trace/core.py`       lógica sem print/input (perfilamento, auth, descoberta, backup, relatório)
- `nx_trace/web/app.py`    backend Flask (API JSON)
- `nx_trace/web/static/`   index.html, styles.css, script.js
- `data/`                  criado na 1ª execução: endpoints.txt, backups/, reports/
  (use a variável NX_TRACE_DATA para mudar a pasta)

O CLI (`nx_trace/scanner.py`) não foi alterado.
