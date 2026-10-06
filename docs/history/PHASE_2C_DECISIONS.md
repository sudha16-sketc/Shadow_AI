# Phase 2C Architecture Decisions

## Decision 1: Gateway Topology
- **Context:** To physically block requests, Shadow AI needs to sit between the user and the AI Provider.
- **Options:** 
  - (A) Enterprise CA TLS Interception (Transparent Proxy)
  - (B) Application-Level API Gateway
  - (C) Enterprise SWG Integration
- **Chosen approach:** (B) Application-Level API Gateway.
- **Reason:** Requires zero certificate management overhead for the enterprise. Clients simply configure their internal network to point AI traffic to `gateway.shadow-ai.com` and use standard Web PKI (Let's Encrypt).
- **Trade-offs:** Requires rewriting client request URLs or using DNS overriding internally. It won't transparently intercept unknown AI providers automatically.
- **Consequences:** We must implement provider-specific request parsing (e.g., understanding the OpenAI JSON schema).

## Decision 2: Streaming Requests
- **Context:** AI APIs heavily use streaming (SSE).
- **Options:** 
  - (A) Fully buffer and inspect streaming requests and responses.
  - (B) Buffer requests for inspection, pass-through streaming responses.
- **Chosen approach:** (B) Buffer requests, pass-through responses.
- **Reason:** Client prompts (the outgoing data) are generally sent in a single JSON payload. The responses are streamed. Since Phase 2C focuses on egress prevention, we do not need to build complex response stream reassembly yet.
- **Trade-offs:** We cannot immediately block sensitive data generated *by* the AI model (Response Inspection).
- **Consequences:** Implementation is drastically simplified for Phase 2C-B.

## Decision 3: Identity & Authentication
- **Context:** The Gateway needs to know who is sending the request.
- **Options:** 
  - (A) Require API keys.
  - (B) Reuse Phase 1 Device JWTs.
- **Chosen approach:** (B) Reuse Phase 1 Device JWTs.
- **Reason:** Prevents building a secondary identity silo. The extension already possesses the JWT, which contains cryptographically verified tenant and user IDs.
- **Trade-offs:** Standard browser clients (like the native ChatGPT UI) will need the extension to inject this JWT into the request headers.
- **Consequences:** If a user uses a pure API script (like a Python bot), they will need a mechanism to obtain a Device JWT.

## Decision 4: Failure Behavior
- **Context:** What happens if the Gateway's connection to the database or Policy Engine fails?
- **Options:** 
  - (A) Fail Open (Allow request, log error).
  - (B) Fail Closed (Block request, return 500).
- **Chosen approach:** (B) Fail Closed.
- **Reason:** Shadow AI is a security product. Failing open compromises the security guarantee. 
- **Trade-offs:** Temporary internal errors will disrupt employee productivity.
- **Consequences:** High availability of the Gateway and Database is critical.
