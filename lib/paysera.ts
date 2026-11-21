import crypto from "node:crypto";

// Paysera Checkout Modern (OAuth2). Tik serveriui – niekada nenaudok naršyklėje.
//
// Paysera dokumentacijos puslapiai šiek tiek skiriasi laukų pavadinimais
// (pvz. order_id / id, payment_URL / link.url, suma skaičiumi / tekstu),
// todėl kodas toleruoja abu variantus.

const API_BASE = "https://api.paysera.com";

function config() {
  const clientId = process.env.PAYSERA_CLIENT_ID;
  const clientSecret = process.env.PAYSERA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Trūksta PAYSERA_CLIENT_ID arba PAYSERA_CLIENT_SECRET.");
  }

  return {
    clientId,
    clientSecret,
    // Nebūtina: jei Paysera API prašo project_id, įrašyk jį į PAYSERA_PROJECT_ID.
    projectId: process.env.PAYSERA_PROJECT_ID,
  };
}

// ---------- OAuth2 prieigos raktas ----------

let cachedToken: { value: string; expiresAt: number } | null = null;

async function fetchToken(): Promise<string> {
  const { clientId, clientSecret } = config();

  const response = await fetch(
    `${API_BASE}/auth/realms/Paysera/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(`Paysera prieigos rakto klaida (${response.status}).`);
  }

  const json = await response.json();

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  };

  return cachedToken.value;
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.value;
  }
  return fetchToken();
}

// ---------- HTTP pagalbinės ----------

type ApiResult = { ok: boolean; status: number; body: any };

async function postJson(path: string, body: unknown): Promise<ApiResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(attempt > 0);

    const response = await fetch(API_BASE + path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    // Pasibaigęs raktas – gauname naują ir bandome dar kartą.
    if (response.status === 401 && attempt === 0) continue;

    const text = await response.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // ne JSON – paliekame tekstą
    }

    return { ok: response.ok, status: response.status, body: parsed };
  }

  throw new Error("Paysera autorizacija nepavyko.");
}

// Vienur dokumentacijoje suma rašoma skaičiumi, kitur tekstu.
// Pirmiausia siunčiame skaičių, o jei API atmeta – bandome tekstą.
async function postWithAmount(
  path: string,
  build: (amount: (cents: number) => number | string) => unknown
): Promise<ApiResult> {
  const first = await postJson(path, build((cents) => cents));

  if (first.ok || (first.status !== 400 && first.status !== 422)) return first;

  const second = await postJson(path, build((cents) => String(cents)));
  return second.ok ? second : first;
}

// ---------- Mokėjimo nuoroda ----------

export type CreatePaymentLinkInput = {
  reference: string; // mūsų užsakymo ID (turi būti unikalus)
  amountCents: number; // centais: 1000 = 10,00 €
  currency: string;
  name: string;
  language: string; // pvz. "lt"
  lifetimeSeconds: number;
  successUrl: string;
  failureUrl: string;
  callbackUrl: string;
};

export async function createPaymentLink(input: CreatePaymentLinkInput): Promise<{
  payseraOrderId: string;
  url: string;
}> {
  const { projectId } = config();

  const orderResult = await postWithAmount(
    "/merchant-order/integration/v1/orders",
    (amount) => ({
      ...(projectId ? { project_id: projectId } : {}),
      redirect_urls: {
        success_url: input.successUrl,
        failure_url: input.failureUrl,
        callback_url: input.callbackUrl,
      },
      purchase: {
        reference: input.reference,
        amount: amount(input.amountCents),
        currency: input.currency,
      },
    })
  );

  if (!orderResult.ok) {
    throw new Error(
      `Paysera užsakymo kūrimo klaida (${orderResult.status}): ${JSON.stringify(orderResult.body)}`
    );
  }

  const payseraOrderId = String(orderResult.body?.order_id ?? orderResult.body?.id ?? "");
  if (!payseraOrderId) {
    throw new Error(`Paysera neatsiuntė užsakymo ID: ${JSON.stringify(orderResult.body)}`);
  }

  const linkResult = await postWithAmount(
    "/checkout-payment-link/integration/v1/payment-links",
    (amount) => ({
      order_id: payseraOrderId,
      name: input.name,
      lifetime: input.lifetimeSeconds,
      experience: { language: input.language },
      purchase: { amount: amount(input.amountCents) },
    })
  );

  if (!linkResult.ok) {
    throw new Error(
      `Paysera nuorodos kūrimo klaida (${linkResult.status}): ${JSON.stringify(linkResult.body)}`
    );
  }

  const url: string | undefined =
    linkResult.body?.payment_URL ??
    linkResult.body?.payment_url ??
    linkResult.body?.link?.url;

  if (!url) {
    throw new Error(`Paysera neatsiuntė mokėjimo nuorodos: ${JSON.stringify(linkResult.body)}`);
  }

  return { payseraOrderId, url };
}

// ---------- Webhook parašas ----------

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// X-Paysera-Signature = HMAC-SHA256(neapdorotas kūnas, client secret).
// Dokumentacija nenurodo kodavimo (hex ar base64), todėl priimame abu.
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;

  const { clientSecret } = config();
  const received = signature.trim();

  const hex = crypto.createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("hex");
  const base64 = crypto.createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("base64");

  return safeEqual(hex, received) || safeEqual(base64, received);
}
