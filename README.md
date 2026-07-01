# Angel V11 Backend PRO

Production-ready backend structure for AI NSE Scanner V11 using Angel One SmartAPI.

## Local Setup

```bash
npm install
cp .env.example .env
npm start
```

## Main Endpoints

- `GET /health`
- `GET /api/market/status`
- `POST /api/market/quote`
- `POST /api/market/scan`

## Quote Body Example

```json
{
  "exchange": "NSE",
  "tradingsymbol": "RELIANCE-EQ",
  "symboltoken": "2885"
}
```

## Render Environment Variables

Add these in Render > Environment:

- ANGEL_API_KEY
- ANGEL_CLIENT_CODE
- ANGEL_PASSWORD
- ANGEL_TOTP_SECRET
- SCANNER_API_KEY
- ALLOWED_ORIGIN
