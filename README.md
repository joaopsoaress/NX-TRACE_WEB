# NX-TRACE

### Lightweight REST API Behavioral Analysis Scanner

NX-TRACE is a CLI-based tool designed for deterministic behavioral analysis of REST API endpoints in controlled environments.

It performs structured inspection of endpoint responses, focusing on authentication signals, latency profiling, structured JSON extraction, and wordlist-based endpoint discovery.

The tool emphasizes clarity, reproducibility, and explicit scope boundaries.

---

## Overview

NX-TRACE provides:

* Sequential endpoint scanning
* HTTP response profiling
* Authentication signal detection
* Wordlist-based endpoint discovery
* Structured JSON response parsing
* Deterministic text-based reporting

Scope: behavioral endpoint analysis only.
Excludes exploitation, bypass attempts, and vulnerability attacks.

---

## Architecture

### Scanner (CLI Application)

The scanner:

* Reads endpoints from `endpoints.txt`
* Sends HTTP requests to a defined target
* Measures response time and size
* Detects authentication indicators
* Extracts structured JSON responses
* Optionally performs endpoint discovery
* Generates a structured report file

---

### Local Testing Environment

A local testing server is included to simulate predictable API behaviors for controlled experimentation.

The server provides endpoints that return:

* Public responses
* Authentication-required responses
* Forbidden access responses
* Structured JSON data
* Artificial latency

This allows deterministic analysis without external targets.

---

## Core Capabilities

### Endpoint Profiling

For each endpoint, NX-TRACE collects:

* HTTP status code
* Response time
* Response size
* Authentication indicators
* JSON response body (when available)

Authentication detection is based on:

* `401` and `403` status codes
* `WWW-Authenticate` headers
* Common authentication-related keywords in response bodies

---

### Endpoint Discovery

Includes wordlist-based endpoint discovery:

* Tests common API paths
* Tries structural variations
* Displays real-time discovery feedback
* Updates `endpoints.txt`
* Creates backups before modification

Discovery remains dictionary-based and deterministic.

---

### JSON Response Analysis

When JSON data is returned:

* The response is parsed and stored
* Structured output is included in the report
* Full JSON payload is preserved

---

### Reporting

After each scan, NX-TRACE generates `report.txt` containing:

* Scan date and target
* Per-endpoint metrics
* Authentication indicators
* Full JSON response data (when available)
* Errors and timeouts
* Summary statistics

---

## Installation

### Requirements

* Python 3.6+
* Dependencies listed in `requirements.txt`

Install:

```bash
pip install -r requirements.txt
```

---

## Usage

### Start the local test server

```bash
python test_server.py
```

Default address:

```
http://localhost:8000
```

### Run the scanner

```bash
python scanner.py
```

Optional endpoint discovery can be enabled before execution.

---

## Configuration

Configuration points:

* `BASE_URL` in `scanner.py`
* Wordlist entries inside `discover_endpoints()`
* `HEADERS` for custom request configuration
* `endpoints.txt` for manual endpoint management

---

## Project Structure

```
NX-TRACE/
├── scanner.py
├── test_server.py
├── endpoints.txt
├── report.txt
├── README.md
└── requirements.txt
```

---

## Security Scope

NX-TRACE is designed for behavioral endpoint analysis.

It does not perform:

* Exploitation
* Brute-force attacks
* Authentication bypass attempts
* Advanced fuzzing
* Vulnerability scanning heuristics
* HTTPS certificate inspection
* External unauthorized scanning

Use only against systems you own or have explicit authorization to test.

---

## Roadmap

Planned improvements may include:

* Concurrent scanning
* Token-based authentication support
* JSON or HTML report export
* Modular architecture
* Extended discovery strategies
* Structured logging
* CI integration

---

## Changelog

### v1.6

Added CLI-based target configuration

### v1.5

* Wordlist-based endpoint discovery
* JSON response extraction
* Enhanced report generation
* Endpoints file backup system

### v1.0

* Initial release
* Basic endpoint scanning
* Authentication signal detection
