import { NextResponse } from "next/server";

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createPaymentLink } from "@/lib/paysera";

export const runtime = "nodejs";

// Turi sutapti su greetingCardPrice (2.00 €) puslapyje page.tsx.
const GREETING_CARD_CENTS = 200;

type IncomingItem = {
  productId: number;
  quantity: number;
  packagingOptionId?: number | null;
  packaging?: string | null;
  itemNote?: string;
  packagingNote?: string;
  giftCard?: boolean;
  giftMessage?: string;
};

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

const toCents = (value: number | string) => Math.round(Number(value) * 100);
const clip = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return bad("Neteisingas užklausos formatas.");
  }

  const name = clip(body?.customer?.name, 120);
  const email = clip(body?.customer?.email, 200);
  const phone = clip(body?.customer?.phone, 40);

  if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
    return bad("Įrašyk vardą ir teisingą el. paštą.");
  }

  const items: IncomingItem[] = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0 || items.length > 50) {
    return bad("Krepšelis tuščias.");
  }

  const admin = createSupabaseAdmin();
  const productIds = [...new Set(items.map((item) => Number(item.productId)))];

  // Kainas imame iš Supabase, o ne iš naršyklės – kliento atsiųstų kainų nepasitikime.
  const [productsRes, linksRes, optionsRes] = await Promise.all([
    admin
      .from("products")
      .select("id, name, category, price")
      .in("id", productIds)
      .eq("is_active", true),
    admin
      .from("product_packaging_options")
      .select("product_id, packaging_option_id")
      .in("product_id", productIds),
    admin
      .from("packaging_options")
      .select("id, name, price")
      .eq("is_active", true),
  ]);

  if (productsRes.error || linksRes.error || optionsRes.error) {
    console.error("checkout load error", productsRes.error, linksRes.error, optionsRes.error);
    return bad("Nepavyko patikrinti krepšelio. Bandyk dar kartą.", 500);
  }

  const products = new Map((productsRes.data ?? []).map((p) => [Number(p.id), p]));
  const options = new Map((optionsRes.data ?? []).map((o) => [Number(o.id), o]));
  const links = new Set(
    (linksRes.data ?? []).map((l) => `${l.product_id}:${l.packaging_option_id}`)
  );

  let totalCents = 0;
  const lines: Record<string, unknown>[] = [];

  for (const item of items) {
    const product = products.get(Number(item.productId));
    const quantity = Number(item.quantity);

    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return bad("Krepšelyje yra neteisingų prekių. Atnaujink puslapį ir bandyk dar kartą.");
    }

    let unitCents = toCents(product.price);
    let packaging: string | null = null;
    const isPackaging = product.category === "Pakavimo paslaugos";

    if (isPackaging) {
      if (!clip(item.itemNote, 500)) {
        return bad("Nenurodyta, ką reikės supakuoti.");
      }

      const optionId =
        item.packagingOptionId === null || item.packagingOptionId === undefined
          ? null
          : Number(item.packagingOptionId);

      if (optionId !== null) {
        const option = options.get(optionId);

        if (!option || !links.has(`${product.id}:${optionId}`)) {
          return bad("Pasirinktas pakavimo būdas nebeprieinamas. Atnaujink puslapį.");
        }

        packaging = option.name;
        // Galutinė kaina = produkto kaina + pakavimo būdo kaina (kaip page.tsx).
        if (option.price !== null) unitCents += toCents(option.price);
      } else {
        // Senas produktas be kainų katalogo – pakavimo kaina nepridedama.
        packaging = clip(item.packaging, 100) || null;
      }
    }

    const giftCard = isPackaging && Boolean(item.giftCard);
    if (giftCard) unitCents += GREETING_CARD_CENTS;

    totalCents += unitCents * quantity;

    lines.push({
      product_id: Number(product.id),
      name: product.name,
      quantity,
      unit_cents: unitCents,
      packaging,
      item_note: clip(item.itemNote, 500),
      packaging_note: clip(item.packagingNote, 500),
      gift_card: giftCard,
      gift_message: giftCard ? clip(item.giftMessage, 500) : "",
    });
  }

  if (totalCents <= 0) return bad("Neteisinga užsakymo suma.");

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      customer_name: name,
      customer_email: email,
      customer_phone: phone || null,
      items: lines,
      total_cents: totalCents,
      currency: "EUR",
      status: "pending",
    })
    .select("id")
    .single();

  if (orderError || !order) {
    console.error("order insert error", orderError);
    return bad("Nepavyko sukurti užsakymo.", 500);
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin).replace(/\/$/, "");

  try {
    const { payseraOrderId, url } = await createPaymentLink({
      reference: String(order.id), // grįš webhook'e kaip order.reference
      amountCents: totalCents, // centais: 1000 = 10,00 €
      currency: "EUR",
      name: `Užsakymas Nr. ${order.id}`,
      language: "lt",
      lifetimeSeconds: 24 * 60 * 60,
      successUrl: `${site}/apmokejimas/sekmingai`,
      failureUrl: `${site}/apmokejimas/atsaukta`,
      callbackUrl: `${site}/api/paysera/callback`,
    });

    await admin.from("orders").update({ paysera_order_id: payseraOrderId }).eq("id", order.id);

    return NextResponse.json({ url });
  } catch (error) {
    console.error("paysera: nepavyko sukurti mokėjimo nuorodos", error);
    await admin.from("orders").update({ status: "payment_error" }).eq("id", order.id);
    return bad("Nepavyko pradėti apmokėjimo. Bandyk dar kartą.", 502);
  }
}
