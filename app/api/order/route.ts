import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// POST /api/order  –  užsakymas apmokėti pagal sąskaitą (kol nėra Paysera).
//
// Ką daro:
//  1) Patikrina krepšelį ir PERSKAIČIUOJA visas kainas iš Supabase (kliento siunčiamomis kainomis nepasitikime).
//  2) Išsaugo užsakymą lentelėje shop_orders (žr. shop_orders.sql) ir gauna užsakymo numerį.
//  3) Išsiunčia laišką apie naują užsakymą per esamą /api/contact (tas pats, kuriuo siunčiama kontaktų forma).
//  4) Grąžina { orderNumber, total } – svetainė parodo išankstinę apmokėjimo sąskaitą.
//
// Reikalingi aplinkos kintamieji (serveryje):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (Supabase -> Project Settings -> API -> service_role; NIEKADA su NEXT_PUBLIC_)

export const runtime = "nodejs";

const PACKAGING_CATEGORY = "Pakavimo paslaugos";
const OTHER_PACKAGING = "Kitas variantas";

type Row = Record<string, unknown>;
type Db = SupabaseClient<any, "public", any>;

class UserError extends Error {}

const str = (value: unknown, max = 500) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const int = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  new Intl.NumberFormat("lt-LT", { style: "currency", currency: "EUR" }).format(n);
const asRows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);
const obj = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};

type Line = {
  productId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  packaging: string;
  packagingPrice: number;
  itemNote: string;
  packagingNote: string;
  buildItems: { id: number; name: string; price: number; quantity: number }[];
};

type Delivery = {
  methodId: number;
  name: string;
  price: number;
  terminal: string;
  terminalId: string;
  address: { street: string; city: string; zip: string } | null;
};

async function buildOrder(db: Db, body: Row) {
  // ---------- Pirkėjas ----------
  const customerRaw = obj(body.customer);
  const customer = {
    name: str(customerRaw.name, 120),
    email: str(customerRaw.email, 200),
    phone: str(customerRaw.phone, 40),
  };

  if (!customer.name) throw new UserError("Įrašyk vardą.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    throw new UserError("Įrašyk teisingą el. pašto adresą.");
  }

  // ---------- Krepšelis ----------
  const rawItems = asRows(body.items);
  if (rawItems.length === 0) throw new UserError("Krepšelis tuščias.");
  if (rawItems.length > 50) throw new UserError("Per daug prekių krepšelyje.");

  const productIds = [...new Set(rawItems.map((item) => int(item.productId)))].filter((id) => id > 0);
  if (productIds.length === 0) throw new UserError("Krepšelyje nėra galiojančių prekių.");

  const { data: productRows, error: productsError } = await db
    .from("products")
    .select("id, name, category, price, builder, is_active")
    .in("id", productIds);
  if (productsError) throw new Error(`products: ${productsError.message}`);

  const products = new Map<number, Row>();
  asRows(productRows).forEach((row) => products.set(Number(row.id), row));

  const optionIds = [
    ...new Set(rawItems.map((item) => int(item.packagingOptionId)).filter((id) => id > 0)),
  ];
  const options = new Map<number, Row>();
  const links = new Set<string>();

  if (optionIds.length > 0) {
    const { data: optionRows, error: optionsError } = await db
      .from("packaging_options")
      .select("id, name, price, is_active")
      .in("id", optionIds);
    if (optionsError) throw new Error(`packaging_options: ${optionsError.message}`);
    asRows(optionRows).forEach((row) => options.set(Number(row.id), row));

    const { data: linkRows, error: linksError } = await db
      .from("product_packaging_options")
      .select("product_id, packaging_option_id")
      .in("product_id", productIds);
    if (linksError) throw new Error(`product_packaging_options: ${linksError.message}`);
    asRows(linkRows).forEach((row) => links.add(`${row.product_id}:${row.packaging_option_id}`));
  }

  const buildIds = [
    ...new Set(
      rawItems.flatMap((item) => asRows(item.buildItems).map((entry) => int(entry.id)))
    ),
  ].filter((id) => id > 0);
  const buildCatalog = new Map<number, Row>();

  if (buildIds.length > 0) {
    const { data: buildRows, error: buildError } = await db
      .from("build_items")
      .select("id, name, price, is_active")
      .in("id", buildIds);
    if (buildError) throw new Error(`build_items: ${buildError.message}`);
    asRows(buildRows).forEach((row) => buildCatalog.set(Number(row.id), row));
  }

  const lines: Line[] = rawItems.map((raw) => {
    const product = products.get(int(raw.productId));
    if (!product || product.is_active === false) {
      throw new UserError("Viena iš prekių krepšelyje nebeprieinama. Atnaujink puslapį ir bandyk dar kartą.");
    }

    const name = String(product.name);
    const quantity = int(raw.quantity);
    if (!(quantity >= 1 && quantity <= 99)) throw new UserError(`Neteisingas „${name}“ kiekis.`);

    const isPackagingService = product.category === PACKAGING_CATEGORY;
    const isBuilder = Boolean(product.builder);

    let packaging = "";
    let packagingPrice = 0;

    if (isPackagingService || isBuilder) {
      const optionId = int(raw.packagingOptionId);

      if (optionId > 0) {
        const option = options.get(optionId);
        if (!option || option.is_active === false || !links.has(`${product.id}:${optionId}`)) {
          throw new UserError(`Pasirinktas „${name}“ įpakavimas nebeprieinamas.`);
        }
        packaging = String(option.name);
        packagingPrice = Number(option.price ?? 0);
      } else {
        // Senas tekstinis pasirinkimas (be kainos).
        packaging = str(raw.packaging, 100);
      }
    }

    const itemNote = str(raw.itemNote, 1000);
    const packagingNote = str(raw.packagingNote, 1000);

    if (isPackagingService && !isBuilder && !itemNote) {
      throw new UserError(`Nurodyk, ką reikės supakuoti („${name}“).`);
    }
    if (packaging === OTHER_PACKAGING && !packagingNote) {
      throw new UserError(`Aprašyk individualų įpakavimą („${name}“).`);
    }

    const buildItems: Line["buildItems"] = [];

    if (isBuilder) {
      for (const entry of asRows(raw.buildItems)) {
        const id = int(entry.id);
        const entryQuantity = int(entry.quantity);
        const catalogItem = buildCatalog.get(id);

        if (!catalogItem || catalogItem.is_active === false || !(entryQuantity >= 1 && entryQuantity <= 20)) {
          throw new UserError(`Neteisingas „${name}“ rinkinio produktas.`);
        }

        buildItems.push({
          id,
          name: String(catalogItem.name),
          price: Number(catalogItem.price),
          quantity: entryQuantity,
        });
      }

      if (buildItems.length === 0) throw new UserError(`Pasirink bent vieną „${name}“ produktą.`);
    }

    const buildTotal = buildItems.reduce((sum, entry) => sum + entry.price * entry.quantity, 0);
    const unitPrice = round2(Number(product.price) + packagingPrice + buildTotal);

    return {
      productId: Number(product.id),
      name,
      quantity,
      unitPrice,
      lineTotal: round2(unitPrice * quantity),
      packaging,
      packagingPrice,
      itemNote,
      packagingNote,
      buildItems,
    };
  });

  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  // ---------- Pristatymas ----------
  const { data: methodRows, error: methodsError } = await db
    .from("delivery_methods")
    .select("id, name, price, needs_terminal, needs_address, is_active")
    .eq("is_active", true);

  // Jei lentelės nėra / ji tuščia – užsakymas priimamas be pristatymo pasirinkimo.
  const methods = methodsError ? [] : asRows(methodRows);
  const deliveryRaw = obj(body.delivery);
  let delivery: Delivery | null = null;

  if (methods.length > 0) {
    const method = methods.find((row) => Number(row.id) === int(deliveryRaw.methodId));
    if (!method) throw new UserError("Pasirink pristatymo būdą.");

    const needsTerminal = Boolean(method.needs_terminal);
    const needsAddress = Boolean(method.needs_address);
    const terminal = str(deliveryRaw.terminal, 300);
    const terminalId = str(deliveryRaw.terminalId, 40);
    const addressRaw = obj(deliveryRaw.address);
    const address = {
      street: str(addressRaw.street, 200),
      city: str(addressRaw.city, 100),
      zip: str(addressRaw.zip, 20),
    };

    if (needsTerminal && !terminal) throw new UserError("Nurodyk paštomatą, į kurį siųsti.");
    if (needsAddress && (!address.street || !address.city || !address.zip)) {
      throw new UserError("Nurodyk pristatymo adresą (gatvė, miestas, pašto kodas).");
    }
    if ((needsTerminal || needsAddress) && !customer.phone) {
      throw new UserError("Nurodyk telefono numerį – jis reikalingas pristatymui.");
    }

    delivery = {
      methodId: Number(method.id),
      name: String(method.name),
      price: round2(Number(method.price ?? 0)),
      terminal: needsTerminal ? terminal : "",
      terminalId: needsTerminal ? terminalId : "",
      address: needsAddress ? address : null,
    };
  }

  const deliveryPrice = delivery?.price ?? 0;

  return { customer, lines, delivery, subtotal, deliveryPrice, total: round2(subtotal + deliveryPrice) };
}

type BuiltOrder = Awaited<ReturnType<typeof buildOrder>>;

function describeLines(order: BuiltOrder) {
  return order.lines.map((line) => {
    const details = [
      line.buildItems.length
        ? `Rinkinio produktai: ${line.buildItems.map((e) => `${e.name} × ${e.quantity}`).join(", ")}`
        : "",
      line.packaging
        ? `Įpakavimas: ${line.packaging}${line.packagingPrice > 0 ? ` (+ ${money(line.packagingPrice)})` : ""}`
        : "",
      line.packagingNote ? `Papildoma įpakavimo idėja: ${line.packagingNote}` : "",
      line.itemNote ? `Daiktas, kurį reikia supakuoti: ${line.itemNote}` : "",
    ].filter(Boolean);

    return [
      `• ${line.name} × ${line.quantity} – ${money(line.lineTotal)}`,
      ...details.map((detail) => `  ${detail}`),
    ].join("\n");
  });
}

// Laiškas apie naują užsakymą – per esamą /api/contact, kad nereikėtų antros pašto sistemos.
// Jei laiško išsiųsti nepavyksta, užsakymas vis tiek išsaugotas (matysite Supabase lentelėje shop_orders).
async function notifyShop(request: Request, number: string, order: BuiltOrder) {
  const { customer, delivery } = order;

  const deliveryLines = delivery
    ? [
        `Pristatymo būdas: ${delivery.name} (${delivery.price > 0 ? money(delivery.price) : "nemokamai"})`,
        delivery.terminal ? `Paštomatas: ${delivery.terminal}${delivery.terminalId ? ` (ID ${delivery.terminalId})` : ""}` : "",
        delivery.address
          ? `Adresas: ${delivery.address.street}, ${delivery.address.city}, ${delivery.address.zip}`
          : "",
      ].filter(Boolean)
    : ["Pristatymas: nepasirinktas"];

  const message = [
    `Naujas užsakymas #${number}. Apmokėjimas – bankiniu pavedimu pagal išankstinę sąskaitą.`,
    "",
    `Pirkėjas: ${customer.name}`,
    `El. paštas: ${customer.email}`,
    `Telefonas: ${customer.phone || "nenurodytas"}`,
    "",
    ...deliveryLines,
    "",
    `Prekių suma: ${money(order.subtotal)}`,
    `Pristatymas: ${money(order.deliveryPrice)}`,
    `Iš viso: ${money(order.total)}`,
    `Mokėjimo paskirtis: Užsakymas #${number}`,
  ].join("\n");

  try {
    const response = await fetch(new URL("/api/contact", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: customer.name,
        email: customer.email,
        subject: `Naujas užsakymas #${number}`,
        message,
        orderSummary: ["UŽSAKYMO PASIRINKIMAI:", ...describeLines(order), `Prekių suma: ${money(order.subtotal)}`].join("\n"),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) console.error(`Laiškas apie užsakymą #${number} neišsiųstas: /api/contact atsakė ${response.status}`);
  } catch (error) {
    console.error(`Laiškas apie užsakymą #${number} neišsiųstas:`, error);
  }
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("/api/order: trūksta NEXT_PUBLIC_SUPABASE_URL arba SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ error: "Užsakymų priėmimas dar nesukonfigūruotas." }, { status: 500 });
  }

  let body: Row;
  try {
    body = obj(await request.json());
  } catch {
    return NextResponse.json({ error: "Neteisinga užklausa." }, { status: 400 });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const order = await buildOrder(db, body);

    const { data, error } = await db
      .from("shop_orders")
      .insert({
        payment_method: "invoice",
        customer_name: order.customer.name,
        customer_email: order.customer.email,
        customer_phone: order.customer.phone,
        delivery_method_id: order.delivery?.methodId ?? null,
        delivery_name: order.delivery?.name ?? null,
        delivery_price: order.deliveryPrice,
        delivery_terminal: order.delivery?.terminal || null,
        delivery_terminal_id: order.delivery?.terminalId || null,
        delivery_address: order.delivery?.address ?? null,
        items: order.lines,
        subtotal: order.subtotal,
        total: order.total,
      })
      .select("number")
      .single();

    if (error || !data) throw new Error(`shop_orders: ${error?.message ?? "nepavyko išsaugoti"}`);

    const number = String((data as Row).number);

    await notifyShop(request, number, order);

    return NextResponse.json({ orderNumber: number, total: order.total });
  } catch (error) {
    if (error instanceof UserError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("/api/order klaida:", error);
    return NextResponse.json({ error: "Nepavyko pateikti užsakymo. Bandyk dar kartą arba parašyk mums." }, { status: 500 });
  }
}