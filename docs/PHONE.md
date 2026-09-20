# Run TW-01 from your phone

TW-01 is a Node 20 application. The easiest no-server-management phone workflow is GitHub Codespaces.

## Phone setup

1. Open the repository on GitHub.
2. Tap Code -> Codespaces -> Create codespace on main.
3. Wait for the Codespace to finish installing dependencies.
4. In the Codespace terminal run: npm run dev
5. Open the forwarded port 3000 when GitHub shows it.
6. The TW-01 dashboard opens in your phone browser.

The repository includes a Dev Container configuration that automatically installs Node dependencies and forwards port 3000.

## Keep it private

Port 3000 is configured as private by default. Do not change it to public unless you understand the security implications.

Do not commit .env, API keys, SMTP passwords, WhatsApp credentials, voice-provider credentials, or authentication secrets.

## Local AI

Ollama is optional. It normally runs on the computer/VM hosting TW-01, not inside a phone browser. TW-01 works without Ollama using its deterministic fallback drafts.

## Important

Codespaces availability and included usage depend on the GitHub account/plan. If Codespaces is unavailable or you run out of included usage, use a Node 20 VPS/cloud host instead.

This setup does not make WhatsApp, SMS, or phone calls magically free. Those channels require a compatible provider and credentials; TW-01 will not pretend a message or call was delivered.