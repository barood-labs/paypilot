# PayPilot
AI booking agent: plain-English job request -> parsed (LLM or rule fallback) -> PayPal sandbox Orders v2 order + AG Grid board.

```
npm install && npm test && npm start
```
Set PAYPAL_CLIENT_ID/SECRET (sandbox) and optional OPENAI_API_KEY; without them it runs in mock mode.
