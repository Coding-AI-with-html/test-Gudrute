import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/paysera";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Paysera šį adresą kviečia POST su JSON (callback_url užsakyme nustatomas automatiškai).
// Čia – vienintelė vieta, kur užsakymas pažymimas kaip apmokėtas.
export async function POST(request: Request) {
  // Parašas skaičiuojamas nuo neapdoroto kūno – pirmiausia skaitome tekstą.
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, request.headers.get("x-paysera-signature"))) {
    console.error("paysera webhook: bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const payseraOrder = payload?.order;

  // Kiti įvykiai (pending_payment, payment_link.expired ir pan.) – nieko nedarome.
  if (payseraOrder?.status !== "paid") {
    return new Response("OK", { status: 200 });
  }

  // Mūsų užsakymo ID nusiunčiame kaip purchase.reference.
  const reference = String(payseraOrder.reference ?? payseraOrder.merchant_order_id ?? "");

  if (!/^\d+$/.test(reference)) {
    console.error("paysera webhook: missing reference", payload);
    return new Response("Missing reference", { status: 400 });
  }

  const admin = createSupabaseAdmin();

  const { data: order, error } = await admin
    .from("orders")
    .select("id, status, total_cents, currency")
    .eq("id", reference)
    .maybeSingle();

  if (error || !order) {
    console.error("paysera webhook: order not found", reference, error);
    return new Response("Order not found", { status: 400 });
  }

  // Pakartotinis pranešimas – nieko nedarome.
  if (order.status === "paid") return new Response("OK", { status: 200 });

  // Jei Paysera atsiuntė sumas – jos turi sutapti su mūsų užsakymu.
  const total = Number(payseraOrder.amount ?? payseraOrder.purchase?.amount);
  const currency = payseraOrder.currency ?? payseraOrder.purchase?.currency;
  const balanceDue = payseraOrder.balanceDue ?? payseraOrder.balance_due;

  const amountMismatch = Number.isFinite(total) && total !== order.total_cents;
  const currencyMismatch = currency !== undefined && currency !== order.currency;
  const notFullyPaid = balanceDue !== undefined && Number(balanceDue) !== 0;

  if (amountMismatch || currencyMismatch || notFullyPaid) {
    console.error("paysera webhook: mismatch", payload, order);
    await admin
      .from("orders")
      .update({ status: "mismatch", paysera_payload: payload })
      .eq("id", order.id);
    return new Response("Mismatch", { status: 400 });
  }

  // .eq("status", "pending") apsaugo nuo dvigubo apdorojimo, jei pranešimas ateina du kartus vienu metu.
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paysera_payload: payload,
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .select("id");

  if (updateError) {
    console.error("paysera webhook: update failed", updateError);
    return new Response("Update failed", { status: 500 });
  }

  if (updated && updated.length > 0) {
    // TODO: čia išsiųsk sau laišką apie naują apmokėtą užsakymą
    // (naudok tą patį siuntimo kodą kaip /api/contact).
  }

  return new Response("OK", { status: 200 });
}
