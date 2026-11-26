import { NextResponse } from "next/server";

// GET /api/terminals?carrier=dpd|lpexpress
// Grąžina paštomatų sąrašą { terminals: [{ id, name, city, address, zip }] }.
//
// Šaltinis: trmnl.lt (nemokami, kasdien atnaujinami JSON sąrašai):
//   DPD         https://trmnl.lt/dpd_lt-all.json        (tik Lietuva)
//   LP Express  https://trmnl.lt/lpexpress-all.json     (faile yra ir LV / EE – paliekame tik LT)
// Duomenys imami tik serveryje ir talpinami 6 val., naršyklė trmnl.lt nekviečia.
//
// Neprivaloma: TRMNL_BASE_URL (numatyta https://trmnl.lt)
//
// Jei šaltinis nepasiekiamas, atsakoma 503 – svetainė tada parodo paprastą tekstinį paštomato laukelį,
// todėl užsakymai nenutrūksta.

export const runtime = "nodejs";

type Carrier = "dpd" | "lpexpress";

type Terminal = {
  id: string;
  name: string;
  city: string;
  address: string;
  zip: string;
};

const SOURCES: Record<Carrier, string> = {
  dpd: "dpd_lt-all.json",
  lpexpress: "lpexpress-all.json",
};

const USER_AGENT = "gudrutes-dezutes-shop/1.0";
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 val.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" };
const cache = new Map<Carrier, { at: number; terminals: Terminal[] }>();

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

// DPD sąraše miestai ir adresai rašomi didžiosiomis („VILNIUS“, „PRIEGLIAUS G. 1“) – pataisome į įprastą rašybą.
function fixCase(value: string) {
  const v = value.trim();
  const lower = v.toLocaleLowerCase("lt");
  if (!v || v !== v.toLocaleUpperCase("lt") || v === lower) return v; // ne visos didžiosios

  return lower
    .replace(/(^|[\s\-(])(\p{L})/gu, (_match, separator: string, letter: string) =>
      separator + letter.toLocaleUpperCase("lt")
    )
    .replace(/\b(G|Pr|Pl|Al|Skg|Tak|Aklg)\./g, (match) => match.toLowerCase());
}

// Kai kuriuose adresuose gale pridėtas miestas („Varnių g. 5 (Meduolis), Kaltinėnai“) – nuimame.
function stripCity(address: string, city: string) {
  const a = address.trimEnd();
  if (
    city &&
    a.length > city.length &&
    a.toLocaleLowerCase("lt").endsWith(city.toLocaleLowerCase("lt"))
  ) {
    const trimmed = a.slice(0, a.length - city.length).replace(/[\s,.]+$/, "");
    if (trimmed) return trimmed;
  }
  return address;
}

async function loadTerminals(carrier: Carrier): Promise<Terminal[]> {
  const baseUrl = (process.env.TRMNL_BASE_URL || "https://trmnl.lt").replace(/\/$/, "");

  const response = await fetch(`${baseUrl}/${SOURCES[carrier]}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`trmnl.lt atsakė ${response.status}`);

  const json: unknown = await response.json();
  if (!Array.isArray(json)) throw new Error("trmnl.lt grąžino netikėtą formatą");

  const seen = new Set<string>();
  const result: Terminal[] = [];

  for (const row of json as Record<string, unknown>[]) {
    // Tik Lietuva (LP Express faile yra ir Latvijos bei Estijos paštomatų).
    const country = text(row.country).toUpperCase();
    if (country && country !== "LT") continue;

    const city = fixCase(text(row.city));
    const address = stripCity(fixCase(text(row.address)), city);
    const id = text(row.terminal_id) || text(row.id);

    // DPD: title yra pavadinimas („PC PUPA DPD paštomatas 001“).
    // LP Express: title yra vietos aprašymas („dešinėje įėjimo į parduotuvę pusėje“), todėl pavadinimą sudarome patys.
    const name = carrier === "lpexpress" ? "LP Express paštomatas" : text(row.title);

    if (!id || !name || !city || !address || seen.has(id)) continue;
    seen.add(id);

    result.push({ id, name, city, address, zip: text(row.post_code) });
  }

  return result.sort(
    (a, b) => a.city.localeCompare(b.city, "lt") || a.address.localeCompare(b.address, "lt")
  );
}

export async function GET(request: Request) {
  const carrier = new URL(request.url).searchParams.get("carrier");

  if (carrier !== "dpd" && carrier !== "lpexpress") {
    return NextResponse.json({ error: "Nežinomas vežėjas." }, { status: 400 });
  }

  const cached = cache.get(carrier);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json({ terminals: cached.terminals }, { headers: CACHE_HEADERS });
  }

  try {
    const terminals = await loadTerminals(carrier);

    if (terminals.length === 0) throw new Error("Paštomatų sąrašas tuščias.");

    cache.set(carrier, { at: Date.now(), terminals });

    return NextResponse.json({ terminals }, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error(`Paštomatų sąrašo klaida (${carrier}):`, error);

    // Jei yra senas sąrašas – geriau jį grąžinti nei nieko.
    if (cached) return NextResponse.json({ terminals: cached.terminals });

    return NextResponse.json(
      { error: "Paštomatų sąrašas šiuo metu nepasiekiamas." },
      { status: 503 }
    );
  }
}