"use client";

import {
  useState,
  useEffect,
  useMemo,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { createSupabaseClient } from "@/lib/supabase/client";
import {
  type PackagingChoice,
  type PackagingOption,
} from "@/lib/products";

// Informacijos / taisyklių puslapis (redaguojamas administravime).
type SitePage = {
  id: number;
  slug: string | null;
  title: string;
  body: string;
};

// Rinkinio produktas iš katalogo (pvz., dešra). Kainą nustato administratorius.
type BuildCatalogItem = {
  id: number;
  name: string;
  price: number;
};

type BuildSelection = {
  id: number;
  name: string;
  price: number;
  quantity: number;
};

// Pristatymo būdas iš Supabase lentelės delivery_methods. Kainą nustato administratorius.
type DeliveryMethod = {
  id: number;
  code: string;
  name: string;
  price: number;
  needsTerminal: boolean;
  needsAddress: boolean;
  // Vežėjas nustatomas pagal kodą (dpd_*, lpexpress_*). Pagal jį kraunamas paštomatų sąrašas.
  carrier: "dpd" | "lpexpress" | null;
};

// Paštomatas iš /api/terminals.
type TerminalOption = {
  id: string;
  name: string;
  city: string;
  address: string;
  zip: string;
};

// Paieškai: ė -> e, š -> s ir pan., kad „gedimino“ ir „Gedimino“ / „Šiaulių“ ir „Siauliu“ sutaptų.
function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function carrierFromCode(code: string): DeliveryMethod["carrier"] {
  const value = code.toLowerCase();
  if (value.startsWith("dpd")) return "dpd";
  if (value.startsWith("lp")) return "lpexpress";
  return null;
}

type Product = {
  id: number;
  name: string;
  category: "Pakavimo paslaugos" | "Dovanų rinkiniai";
  price: number;
  description: string;
  // Kas įeina į rinkinį (kiekviena eilutė – atskira pozicija).
  contents: string;
  image: string;
  image_urls: string[];
  label: string;
  // true = rinkinį kuria klientas („Susikurk pats“).
  builder: boolean;
  packaging_mode:
    | "none"
    | "fixed_paper_box"
    | "fixed_basket"
    | "custom";
  // Senas laukas paliktas suderinamumui su anksčiau sukurtais produktais.
  packaging_choices: PackagingChoice[];
  // Aktyvūs pakavimo variantai su jų kainomis iš Supabase katalogo.
  packaging_options: PackagingOption[];
};

type PackagingConfig = {
  packaging: PackagingChoice;
  packagingOptionId: number | null;
  packagingPrice: number | null;
  packagingNote: string;
  itemNote: string;
  // Rinkinio produktų kiekiai („Susikurk pats“): katalogo produkto id → kiekis.
  buildQuantities: Record<number, number>;
};

type CartItem = {
  lineId: string;
  id: number;
  quantity: number;
  packaging?: PackagingChoice;
  packagingOptionId?: number | null;
  packagingPrice?: number | null;
  packagingNote?: string;
  itemNote?: string;
  buildItems?: BuildSelection[];
};

function createPackagingConfig(product: Product): PackagingConfig {
  const firstOption = product.packaging_options?.[0];

  return {
    packaging:
      firstOption?.name ?? product.packaging_choices?.[0] ?? "Popierinė dėžutė",
    packagingOptionId: firstOption?.id ?? null,
    packagingPrice: firstOption?.price ?? null,
    packagingNote: "",
    itemNote: "",
    buildQuantities: {},
  };
}

// Galutinė kaina = produkto kaina + pasirinkto pakavimo būdo kaina.
// Jei pakavimo būdo kaina nenustatyta, prie produkto kainos nieko nepridedama.
function getBuildItemsTotal(buildItems: BuildSelection[] | undefined): number {
  return (buildItems ?? []).reduce((sum, entry) => sum + entry.price * entry.quantity, 0);
}

// Pakuojamoms paslaugoms: produktas + pakavimas. „Susikurk pats“: bazinė kaina + pasirinkti
// produktai + pakavimas.
function getCartItemUnitPrice(product: Product, item: CartItem): number {
  const packagingPrice =
    product.category === "Pakavimo paslaugos" || product.builder
      ? item.packagingPrice ?? 0
      : 0;

  return product.price + packagingPrice + getBuildItemsTotal(item.buildItems);
}




// Paryškina tekstą, apsuptą **dvigubomis žvaigždutėmis**.
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

// Taisyklių tekstas iš administravimo: „## Antraštė“, „- punktas“, tuščia eilutė skiria
// pastraipas, **paryškinimas**.
function renderRichText(body: string) {
  const out: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const lines = paragraph;
    out.push(
      <p key={`p-${out.length}`}>
        {lines.map((line, index) => (
          <span key={index}>
            {index > 0 && <br />}
            {renderInline(line)}
          </span>
        ))}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list.length) return;
    const items = list;
    out.push(
      <ul key={`l-${out.length}`}>
        {items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    list = [];
  };

  body.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
    } else if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      out.push(<h4 key={`h-${out.length}`}>{renderInline(line.slice(3))}</h4>);
    } else if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
    } else {
      flushList();
      paragraph.push(line);
    }
  });

  flushParagraph();
  flushList();
  return out;
}

// Rinkinio sudėties tekstas iš administravimo: kiekviena eilutė – sąrašo punktas;
// eilutė, prasidedanti „!“, rodoma kaip paryškinta pastaba.
type ContentBlock =
  | { type: "list"; items: string[] }
  | { type: "note"; text: string };

function parseContents(contents: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (line.startsWith("!")) {
        const text = line.replace(/^!+\s*/, "");
        if (text) blocks.push({ type: "note", text });
        return;
      }

      const last = blocks[blocks.length - 1];
      if (last && last.type === "list") last.items.push(line);
      else blocks.push({ type: "list", items: [line] });
    });

  return blocks;
}

const categories = [
  "Dovanų rinkiniai",
  "Pakavimo paslaugos",
  "Visos prekės",
] as const;

type Category = (typeof categories)[number];

const money = (amount: number) =>
  new Intl.NumberFormat("lt-LT", {
    style: "currency",
    currency: "EUR",
  }).format(amount);

// Kol nėra Paysera leidimo, užsakymas pateikiamas apmokėti pagal sąskaitą.
// Kai Paysera bus paruošta: NEXT_PUBLIC_PAYSERA_ENABLED=true (.env / Vercel nustatymuose).
const PAYSERA_ENABLED = process.env.NEXT_PUBLIC_PAYSERA_ENABLED === "true";

export default function Home() {
  
  const supabase = useMemo(() => createSupabaseClient(), []);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");

  const [buildCatalog, setBuildCatalog] = useState<BuildCatalogItem[]>([]);
  const [sitePages, setSitePages] = useState<SitePage[]>([]);
  const [openPageId, setOpenPageId] = useState<number | null>(null);

  const [packagingConfigs, setPackagingConfigs] = useState<
    Record<number, PackagingConfig>
  >({});

  const [activeImages, setActiveImages] = useState<
    Record<number, number>
  >({});

  // Padidintos nuotraukų galerijos būsena.
  const [galleryProductId, setGalleryProductId] = useState<number | null>(null);
  const [galleryImageIndex, setGalleryImageIndex] = useState(0);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [filter, setFilter] = useState<Category>("Dovanų rinkiniai");
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);
  const [contactError, setContactError] = useState("");
  const [checkoutSending, setCheckoutSending] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [deliveryMethods, setDeliveryMethods] = useState<DeliveryMethod[]>([]);
  const [deliveryMethodId, setDeliveryMethodId] = useState<number | null>(null);
  const [orderPlaced, setOrderPlaced] = useState<{ number: string } | null>(null);
  // Atskiras užsakymo pateikimo langas (kontaktai, pristatymas, užsakymo santrauka).
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // Paštomatai pagal vežėją: sąrašas, "loading" arba "error" (tada rodomas tekstinis laukelis).
  const [terminals, setTerminals] = useState<
    Record<string, TerminalOption[] | "loading" | "error">
  >({});
  const [terminalCity, setTerminalCity] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [terminalQuery, setTerminalQuery] = useState("");

  // Jei klientas grįžta atgal iš Paysera puslapio, mygtukas vėl tampa aktyvus.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) setCheckoutSending(false);
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  // Taisyklės / DUK: neprivalomas turinys, todėl klaida tiesiog palieka sąrašą tuščią.
  useEffect(() => {
    let active = true;

    async function loadSitePages() {
      const { data, error } = await supabase
        .from("site_pages")
        .select("id, slug, title, body")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (!active) return;

      if (error) {
        console.error("Nepavyko įkelti taisyklių:", error.message);
        return;
      }

      setSitePages(
        ((data ?? []) as { id: number; slug: string | null; title: string; body: string }[]).map(
          (row) => ({ id: Number(row.id), slug: row.slug, title: row.title, body: row.body })
        )
      );
    }

    void loadSitePages();

    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    let active = true;

    async function loadProducts() {
      setProductsLoading(true);
      setProductsError("");

      try {
        const [
          { data, error },
          { data: links, error: linksError },
          { data: optionRows, error: optionsError },
          { data: buildRows, error: buildError },
        ] = await Promise.all([
          supabase
            .from("products")
            .select(
              "id, name, category, price, description, contents, image_urls, label, builder, packaging_mode, packaging_choices"
            )
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true }),
          supabase
            .from("product_packaging_options")
            .select("product_id, packaging_option_id"),
          supabase
            .from("packaging_options")
            .select("id, name, price, is_active, sort_order")
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true }),
          supabase
            .from("build_items")
            .select("id, name, price")
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true }),
        ]);

        if (error) throw error;
        if (linksError) throw new Error(`Nepavyko įkelti produktų pakavimo būdų: ${linksError.message}`);
        if (optionsError) throw new Error(`Nepavyko įkelti pakavimo būdų katalogo: ${optionsError.message}`);

        if (!active) return;

        // Rinkinio produktų katalogas nėra kritinis: jei jo nepavyko įkelti, tiesiog rodomas tuščias.
        if (buildError) console.error("Nepavyko įkelti rinkinio produktų:", buildError.message);
        setBuildCatalog(
          ((buildRows ?? []) as { id: number; name: string; price: number | string }[]).map(
            (row) => ({ id: Number(row.id), name: row.name, price: Number(row.price) })
          )
        );

        type ProductRow = {
          id: number;
          name: string;
          category: Product["category"];
          price: number | string;
          description: string;
          contents: string | null;
          image_urls: string[] | null;
          label: string | null;
          builder: boolean | null;
          packaging_mode: Product["packaging_mode"] | null;
          packaging_choices: PackagingChoice[] | null;
        };
        type ProductPackagingLink = {
          product_id: number;
          packaging_option_id: number;
        };
        type PackagingOptionRow = {
          id: number;
          name: string;
          price: number | string | null;
          is_active: boolean;
          sort_order: number | null;
        };

        const rows = (data ?? []) as ProductRow[];
        const activeOptions = (optionRows ?? []) as PackagingOptionRow[];
        const optionsById = new Map<number, PackagingOption>();
        activeOptions.forEach((option) => {
          optionsById.set(Number(option.id), {
            id: Number(option.id),
            name: option.name,
            price: option.price === null ? null : Number(option.price),
            is_active: option.is_active,
            sort_order: Number(option.sort_order ?? 0),
          });
        });
        const optionsByProduct = new Map<number, PackagingOption[]>();

        ((links ?? []) as ProductPackagingLink[]).forEach((link) => {
          const option = optionsById.get(Number(link.packaging_option_id));
          if (!option) return;

          const productId = Number(link.product_id);
          const current = optionsByProduct.get(productId) ?? [];
          current.push(option);
          optionsByProduct.set(productId, current);
        });
        optionsByProduct.forEach((options) => {
          options.sort(
            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "lt")
          );
        });

        const mappedProducts: Product[] = rows.map((row) => {
          const imageUrls = row.image_urls ?? [];

          return {
            id: Number(row.id),
            name: row.name,
            category: row.category,
            price: Number(row.price),
            description: row.description,
            contents: row.contents ?? "",
            image_urls: imageUrls,
            image: imageUrls[0] || "/logo.png",
            label: row.label ?? "",
            builder: Boolean(row.builder),
            packaging_mode: row.packaging_mode ?? "none",
            packaging_choices: row.packaging_choices ?? [],
            packaging_options: optionsByProduct.get(Number(row.id)) ?? [],
          };
        });

        setProducts(mappedProducts);

        setPackagingConfigs((current) => {
          const next = { ...current };

          mappedProducts.forEach((product) => {
            if (product.category !== "Pakavimo paslaugos" && !product.builder) return;

            const currentConfig = next[product.id];
            const selectedOption = product.packaging_options.find(
              (option) => option.id === currentConfig?.packagingOptionId
            ) ?? product.packaging_options.find(
              (option) => option.name === currentConfig?.packaging
            );

            if (!currentConfig) {
              next[product.id] = createPackagingConfig(product);
            } else if (selectedOption) {
              // Atnaujiname ir kainą, jei administratorius ją pakeitė.
              next[product.id] = {
                ...currentConfig,
                packaging: selectedOption.name,
                packagingOptionId: selectedOption.id,
                packagingPrice: selectedOption.price,
              };
            } else if (product.packaging_options.length > 0) {
              // Jei anksčiau pasirinktas būdas pašalintas iš prekės, parenkame pirmą aktyvų.
              next[product.id] = {
                ...currentConfig,
                packaging: product.packaging_options[0].name,
                packagingOptionId: product.packaging_options[0].id,
                packagingPrice: product.packaging_options[0].price,
                packagingNote: "",
              };
            }
          });

          return next;
        });
      } catch (error) {
        if (active) {
          setProductsError(
            error instanceof Error
              ? error.message
              : "Nepavyko įkelti produktų."
          );
        }
      } finally {
        if (active) setProductsLoading(false);
      }
    }

    void loadProducts();

    return () => {
      active = false;
    };
  }, [supabase]);


    const visibleProducts = products.filter(
    (product) =>
      filter === "Visos prekės" || product.category === filter
  );

  const firstPackagingProductId = products.find(
    (product) => product.category === "Pakavimo paslaugos"
  )?.id;

  const firstGiftSetProductId = products.find(
    (product) => product.category === "Dovanų rinkiniai"
  )?.id;

  // Pristatymo būdai: neprivalomas turinys. Jei lentelės nėra / ji tuščia, pasirinkimas nerodomas.
  useEffect(() => {
    let active = true;

    async function loadDeliveryMethods() {
      const { data, error } = await supabase
        .from("delivery_methods")
        .select("id, code, name, price, needs_terminal, needs_address")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (!active) return;

      if (error) {
        console.error("Nepavyko įkelti pristatymo būdų:", error.message);
        return;
      }

      const methods = (
        (data ?? []) as {
          id: number;
          code: string;
          name: string;
          price: number | string | null;
          needs_terminal: boolean | null;
          needs_address: boolean | null;
        }[]
      ).map((row) => ({
        id: Number(row.id),
        code: row.code,
        carrier: carrierFromCode(row.code),
        name: row.name,
        price: Number(row.price ?? 0),
        needsTerminal: Boolean(row.needs_terminal),
        needsAddress: Boolean(row.needs_address),
      }));

      setDeliveryMethods(methods);
      setDeliveryMethodId((current) => current ?? methods[0]?.id ?? null);
    }

    void loadDeliveryMethods();

    return () => {
      active = false;
    };
  }, [supabase]);

  // Uždarius krepšelį ir užsakymo langą, padėkos būsena dingsta.
  useEffect(() => {
    if (!cartOpen && !checkoutOpen) setOrderPlaced(null);
  }, [cartOpen, checkoutOpen]);

  // Escape uždaro užsakymo langą (kol siunčiama – ne).
  useEffect(() => {
    if (!checkoutOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !checkoutSending) setCheckoutOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkoutOpen, checkoutSending]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const cartTotal = cart.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.id);
    const unitPrice = product ? getCartItemUnitPrice(product, item) : 0;
    return sum + unitPrice * item.quantity;
  }, 0);

  const selectedDelivery =
    deliveryMethods.find((method) => method.id === deliveryMethodId) ?? null;
  const deliveryPrice = selectedDelivery?.price ?? 0;
  const orderTotal = cartTotal + deliveryPrice;
  // Kurjeriui ir paštomatui telefonas reikalingas SMS pranešimams.
  const deliveryNeedsPhone = Boolean(
    selectedDelivery?.needsTerminal || selectedDelivery?.needsAddress
  );

  // Paštomatų sąrašas kraunamas tik atidarius užsakymo langą ir pasirinkus paštomato pristatymą.
  const terminalCarrier = selectedDelivery?.needsTerminal ? selectedDelivery.carrier : null;
  const terminalState = terminalCarrier ? terminals[terminalCarrier] : undefined;
  const terminalList = Array.isArray(terminalState) ? terminalState : [];

  useEffect(() => {
    if (!terminalCarrier || !checkoutOpen || terminals[terminalCarrier]) return;

    const carrier = terminalCarrier;
    setTerminals((current) => ({ ...current, [carrier]: "loading" }));

    fetch(`/api/terminals?carrier=${carrier}`)
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(result.terminals) || result.terminals.length === 0) {
          throw new Error(result.error || `Nepavyko įkelti paštomatų (HTTP ${response.status}).`);
        }
        return result.terminals as TerminalOption[];
      })
      .then((list) => setTerminals((current) => ({ ...current, [carrier]: list })))
      .catch((error) => {
        console.error("Paštomatų sąrašas nepasiekiamas, naudojamas tekstinis laukelis:", error);
        setTerminals((current) => ({ ...current, [carrier]: "error" }));
      });
  }, [terminalCarrier, checkoutOpen, terminals]);

  const terminalCities = Array.from(
    new Set(terminalList.map((terminal) => terminal.city).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "lt"));
  const terminalCityCounts = new Map<string, number>();
  terminalList.forEach((terminal) =>
    terminalCityCounts.set(terminal.city, (terminalCityCounts.get(terminal.city) ?? 0) + 1)
  );
  const terminalsInCity = terminalList.filter((terminal) => terminal.city === terminalCity);
  const selectedTerminal =
    terminalsInCity.find((terminal) => terminal.id === terminalId) ?? null;

  // Paieška pagal adresą / gatvę / miestą / pavadinimą / pašto kodą (visi įvesti žodžiai turi sutapti).
  const terminalSearchWords = normalizeSearch(terminalQuery).split(/\s+/).filter(Boolean);
  const terminalSearchActive = terminalSearchWords.join("").length >= 2;
  const terminalMatchesAll = terminalSearchActive
    ? terminalList
        .filter((terminal) => {
          const haystack = normalizeSearch(
            `${terminal.name} ${terminal.address} ${terminal.city} ${terminal.zip}`
          );
          return terminalSearchWords.every((word) => haystack.includes(word));
        })
    : [];
  // Rodome iki 100 rezultatų (sąrašas slenka); jei jų daugiau – prašome patikslinti paiešką.
  const terminalMatches = terminalMatchesAll.slice(0, 100);

  function pickTerminal(terminal: TerminalOption) {
    setTerminalCity(terminal.city);
    setTerminalId(terminal.id);
    setTerminalQuery("");
  }

  const galleryProduct =
    galleryProductId === null
      ? null
      : products.find((product) => product.id === galleryProductId) ?? null;

  const galleryImages = galleryProduct
    ? galleryProduct.image_urls.length > 0
      ? galleryProduct.image_urls
      : [galleryProduct.image]
    : [];
  const safeGalleryImageIndex = galleryImages.length > 0
    ? Math.min(galleryImageIndex, galleryImages.length - 1)
    : 0;

  useEffect(() => {
    if (galleryProductId === null) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleGalleryKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setGalleryProductId(null);
      }

      if (galleryImages.length > 1 && event.key === "ArrowRight") {
        setGalleryImageIndex((current) => (current + 1) % galleryImages.length);
      }

      if (galleryImages.length > 1 && event.key === "ArrowLeft") {
        setGalleryImageIndex(
          (current) => (current - 1 + galleryImages.length) % galleryImages.length
        );
      }
    }

    window.addEventListener("keydown", handleGalleryKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGalleryKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [galleryProductId, galleryImages.length]);

    function updatePackagingConfig(
    id: number,
    changes: Partial<PackagingConfig>
  ) {
    const product = products.find((item) => item.id === id);

    if (!product) return;

    setPackagingConfigs((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? createPackagingConfig(product)),
        ...changes,
      },
    }));
  }

  function addToCart(id: number) {
    const product = products.find((item) => item.id === id);
    if (!product) return;

    // Konfigūracija taikoma pakavimo paslaugoms ir „Susikurk pats“ rinkiniams.
    const isPackaging = product.category === "Pakavimo paslaugos";
    const config =
      isPackaging || product.builder
        ? packagingConfigs[id] ?? createPackagingConfig(product)
        : undefined;

    const buildItems: BuildSelection[] = product.builder && config
      ? buildCatalog
          .filter((entry) => (config.buildQuantities[entry.id] ?? 0) > 0)
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            price: entry.price,
            quantity: config.buildQuantities[entry.id],
          }))
      : [];

    if (product.builder && buildItems.length === 0) {
      setNotice("Pasirink bent vieną produktą savo rinkiniui.");
      return;
    }

    if (config && isPackaging && !config.itemNote.trim()) {
      setNotice("Parašyk, kokį daiktą reikės supakuoti ir nurodyk apytikslį jo dydį.");
      return;
    }

    if (config?.packaging === "Kitas variantas" && !config.packagingNote.trim()) {
      setNotice("Aprašyk, kokio individualaus įpakavimo norėtum.");
      return;
    }

    const lineId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Kiekvienas skirtingas pasirinkimų rinkinys krepšelyje išsaugomas atskirai.
    setCart((current) => [
      ...current,
      {
        lineId,
        id,
        quantity: 1,
        ...(config
          ? {
              packaging: config.packaging,
              packagingOptionId: config.packagingOptionId,
              packagingPrice: config.packagingPrice,
              packagingNote: config.packagingNote,
              itemNote: config.itemNote,
              buildItems: product.builder ? buildItems : undefined,
            }
          : {}),
      },
    ]);

    setOrderPlaced(null);
    setNotice(`„${product.name}“ pridėta į krepšelį`);
    setCartOpen(true);
  }

  function changeQuantity(lineId: string, change: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.lineId === lineId
            ? { ...item, quantity: item.quantity + change }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function removeFromCart(lineId: string) {
    setCart((current) => current.filter((item) => item.lineId !== lineId));
  }

  // Siunčia krepšelį į serverį. Serveris pats perskaičiuoja kainas iš Supabase,
  // sukuria užsakymą ir (jei Paysera įjungta) grąžina mokėjimo nuorodą. Kitu atveju užsakymas
  // pateikiamas apmokėti pagal sąskaitą.
  async function handleCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (cart.length === 0 || checkoutSending) return;

    const form = event.currentTarget;
    const data = new FormData(form);

    const phone = String(data.get("phone") ?? "").trim();
    const terminal = String(data.get("delivery_terminal") ?? "").trim();
    const terminalIdValue = String(data.get("delivery_terminal_id") ?? "").trim();
    const street = String(data.get("delivery_street") ?? "").trim();
    const city = String(data.get("delivery_city") ?? "").trim();
    const zip = String(data.get("delivery_zip") ?? "").trim();

    if (deliveryMethods.length > 0 && !selectedDelivery) {
      setCheckoutError("Pasirink pristatymo būdą.");
      return;
    }

    if (selectedDelivery?.needsTerminal && !terminal) {
      setCheckoutError("Nurodyk paštomatą, į kurį siųsti.");
      return;
    }

    if (selectedDelivery?.needsAddress && (!street || !city || !zip)) {
      setCheckoutError("Nurodyk pristatymo adresą (gatvė, miestas, pašto kodas).");
      return;
    }

    if (deliveryNeedsPhone && !phone) {
      setCheckoutError("Nurodyk telefono numerį – jis reikalingas pristatymui.");
      return;
    }

    setCheckoutSending(true);
    setCheckoutError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: PAYSERA_ENABLED ? "paysera" : "invoice",
          customer: {
            name: String(data.get("name") ?? "").trim(),
            email: String(data.get("email") ?? "").trim(),
            phone,
          },
          delivery: selectedDelivery
            ? {
                methodId: selectedDelivery.id,
                terminal: selectedDelivery.needsTerminal ? terminal : "",
                terminalId: selectedDelivery.needsTerminal ? terminalIdValue : "",
                address: selectedDelivery.needsAddress ? { street, city, zip } : null,
              }
            : null,
          items: cart.map((item) => ({
            productId: item.id,
            quantity: item.quantity,
            packagingOptionId: item.packagingOptionId ?? null,
            packaging: item.packaging ?? null,
            itemNote: item.itemNote ?? "",
            packagingNote: item.packagingNote ?? "",
            buildItems: (item.buildItems ?? []).map((entry) => ({
              id: entry.id,
              quantity: entry.quantity,
            })),
          })),
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Nepavyko pateikti užsakymo. Bandyk dar kartą.");
      }

      if (PAYSERA_ENABLED) {
        if (!result.url) {
          throw new Error(result.error || "Nepavyko pradėti apmokėjimo. Bandyk dar kartą.");
        }

        // Nukreipiame į Paysera apmokėjimo puslapį.
        window.location.href = result.url;
        return;
      }

      // Užsakymas pateiktas pagal sąskaitą: išvalome krepšelį ir parodome padėką.
      setCart([]);
      setNotice("");
      setOrderPlaced({ number: String(result.orderNumber ?? "") });
      setTerminalCity("");
      setTerminalId("");
      setTerminalQuery("");
      setCheckoutSending(false);
      form.reset();
    } catch (error) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "Nepavyko pateikti užsakymo. Patikrink interneto ryšį ir bandyk dar kartą."
      );
      setCheckoutSending(false);
    }
  }

  async function handleContactSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const subject = String(data.get("subject") ?? "Užklausa iš svetainės");
    const message = String(data.get("message") ?? "").trim();

    const orderLines = cart.map((item) => {
      const product = products.find((entry) => entry.id === item.id);
      if (!product) return "";

      const unitPrice = getCartItemUnitPrice(product, item);
      const details = [
        item.buildItems?.length
          ? `Rinkinio produktai: ${item.buildItems.map((entry) => `${entry.name} × ${entry.quantity}`).join(", ")}`
          : "",
        item.packaging
          ? product.builder
            ? `Įpakavimas: ${item.packaging}`
            : `Įpakavimas: ${item.packaging} (+ ${money(item.packagingPrice ?? 0)})`
          : "",
        item.packagingNote ? `Papildoma įpakavimo idėja: ${item.packagingNote}` : "",
        item.itemNote ? `Daiktas, kurį reikia supakuoti: ${item.itemNote}` : "",
      ].filter(Boolean);

      return [
        `• ${product.name} × ${item.quantity} – ${money(unitPrice * item.quantity)}`,
        ...details.map((detail) => `  ${detail}`),
      ].join("\n");
    }).filter(Boolean);

    const orderSummary = orderLines.length
      ? ["UŽSAKYMO PASIRINKIMAI:", ...orderLines, `Prekių suma: ${money(cartTotal)}`].join("\n")
      : "Krepšelis nepateiktas.";

    setContactSending(true);
    setContactError("");
    setContactSent(false);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message, orderSummary }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Nepavyko išsiųsti laiško.");
      }

      setContactSent(true);
      form.reset();
    } catch (error) {
      setContactError(
        error instanceof Error
          ? error.message
          : "Nepavyko išsiųsti laiško. Patikrink interneto ryšį ir bandyk dar kartą."
      );
    } finally {
      setContactSending(false);
    }
  }

  return (
    <main>
      
      <div className="announcement">
        <span>Dovanos</span>
        <span className="dash">—</span>
        <span>supakuotos su meile</span>
        <span className="heart">♡</span>
      </div>


      <header className="header">
        <button
          className="mobile-menu"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? "Uždaryti meniu" : "Atidaryti meniu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? "×" : "☰"}
        </button>

        <a className="brand" href="#pradzia" aria-label="Gudrutės dėžutės – pradžia">
          <span>Gudrutės</span>
          <small>D Ė Ž U T Ė S</small>
        </a>

        <nav className={menuOpen ? "nav nav-open" : "nav"}>
          <a href="#paslaugos" onClick={() => setMenuOpen(false)}>
            Paslaugos
          </a>
          <a href="#parduotuve" onClick={() => setMenuOpen(false)}>
            Parduotuvė
          </a>
          <a href="#apie" onClick={() => setMenuOpen(false)}>
            Apie mus
          </a>
          {sitePages.length > 0 && (
            <a href="#taisykles" onClick={() => setMenuOpen(false)}>
              Taisyklės
            </a>
          )}
          <a href="#kontaktai" onClick={() => setMenuOpen(false)}>
            Kontaktai
          </a>
        </nav>

        
        <button
          className="cart-link"
          onClick={() => setCartOpen(true)}
          aria-expanded={cartOpen}
          aria-label={`Atidaryti krepšelį, prekių skaičius: ${cartCount}`}
        >
          <span className="cart-link-label">Mano krepšelis</span>
          <span className="cart-bag-icon" aria-hidden="true">♧</span>
          <span className="cart-badge">{cartCount}</span>
        </button>

      </header>

      <section className="hero" id="pradzia">
        <div className="hero-copy">
          <p className="eyebrow">MAŽOS DETALĖS — DIDELIS DŽIAUGSMAS</p>

          <h1>
            Dovana prasideda
            <br />
            nuo <em>įpakavimo</em>
          </h1>

          <p className="hero-description">
            Dovanų pakavimas, kuriame svarbi kiekviena detalė –
            nuo klasikinės dėžutės iki individualaus įpakavimo.
          </p>

          <div className="hero-actions">
            <a className="button button-dark" href="#parduotuve">
              Atrasti kolekciją <span>↗</span>
            </a>
            <a className="text-link" href="#paslaugos">
              Mūsų paslaugos
            </a>
          </div>

          <p className="hero-note">
           
          </p>
        </div>

        <div className="hero-art">
          <img
            src="/logo.png"
            alt="Gudrutės dėžutės logotipas"
            className="hero-logo"
          />
          <span className="hero-stamp">MADE WITH LOVE ♡</span>
        </div>

        <div className="hero-index"> DOVANŲ KULTŪRA</div>
      </section>

      <section className="benefits" aria-label="Mūsų vertybės">
        <div><span>✳</span> Kruopštus rankų darbas</div>
        <div><span>♡</span> Kiekviena detalė svarbi</div>
        <div><span>✧</span> Elegancija be pertekliaus</div>
      </section>

      <section className="section" id="paslaugos">
        <div className="section-heading">
          <p className="eyebrow">KĄ GALIME SUKURTI?</p>
          <h2>Dovana <em>— tai nauja patirtis</em></h2>
          <p>
            Pasirūpiname detalėmis, kad tau liktų džiaugsmas dovanoti ♡
          </p>
        </div>

        <div className="service-grid">
          <a
            className="service-card service-one"
            href="#parduotuve"
            onClick={() => setFilter("Pakavimo paslaugos")}
          >
            <span className="service-number">01 / PASLAUGA</span>
            <div>
              <h3>Dovanų pakavimas</h3>
              <p>
                Supakuojame tavo atneštą ar pasirinktą daiktą – nuo popierinės dėžutės iki individualaus sprendimo.
              </p>
              <span className="text-link">Atrasti pakavimo paslaugas ↗</span>
            </div>
          </a>

          <a
            className="service-card service-two"
            href="#parduotuve"
            onClick={() => setFilter("Dovanų rinkiniai")}
          >
            <span className="service-number">02 / KOLEKCIJA</span>
            <div>
              <h3>Dovanų rinkiniai</h3>
              <p>
                Kruopščiai suderintos smulkmenos gimtadieniams,
                šventėms ir jaukioms staigmenoms.
              </p>
              <span className="text-link">Atrasti dovanų rinkinius ↗</span>
            </div>
          </a>
        </div>
      </section>

      <section className="section products-section" id="parduotuve">
        <div className="products-top">
          <div>
            <p className="eyebrow">ATRINKTA TAU</p>
            <h2>Maži <em>džiaugsmai</em></h2>
            <p className="section-intro">
              Pasirink, kaip supakuosime tavo dovaną
            </p>
          </div>

          <div className="filters" aria-label="Prekių kategorijos">
            {categories.map((category) => (
              <button
                key={category}
                className={filter === category ? "filter active" : "filter"}
                onClick={() => setFilter(category)}
                aria-pressed={filter === category}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {productsLoading && (
          <p className="catalog-note">Įkeliame produktus...</p>
        )}

        {productsError && (
          <p className="form-hint" role="alert">
            Nepavyko įkelti produktų: {productsError}
          </p>
        )}

        {!productsLoading && !productsError && visibleProducts.length === 0 && (
          <p className="catalog-note">
            Šioje kategorijoje produktų šiuo metu nėra.
          </p>
        )}

        
        <div className="product-grid">
          {visibleProducts.map((product) => {
            const config =
              packagingConfigs[product.id] ?? createPackagingConfig(product);
            // Pirmiausia naudojame naują kainų katalogą. Senas text[] laukas
            // paliktas tik atsarginiam suderinamumui su senomis prekėmis.
            const packagingOptions: PackagingOption[] = product.packaging_options.length
              ? product.packaging_options
              : (product.packaging_choices.length ? product.packaging_choices : ["Popierinė dėžutė"])
                  .map((name, index) => ({
                    id: -(index + 1),
                    name,
                    price: null,
                    is_active: true,
                    sort_order: index,
                  }));
            const selectedPackagingOption = packagingOptions.find(
              (option) => option.id === config.packagingOptionId
            ) ?? packagingOptions.find((option) => option.name === config.packaging);
            // Galutinė kaina = produkto kaina + pasirinkto pakavimo būdo kaina.
            const selectedPackagingPrice = selectedPackagingOption?.price ?? 0;
            const displayedProductPrice =
              product.price +
              (product.category === "Pakavimo paslaugos" || product.builder ? selectedPackagingPrice : 0) +
              (product.builder
                ? buildCatalog.reduce(
                    (sum, entry) => sum + entry.price * (config.buildQuantities[entry.id] ?? 0),
                    0
                  )
                : 0);

            const imageIndex = Math.min(
              activeImages[product.id] ?? 0,
              Math.max(0, product.image_urls.length - 1)
            );

            return (
              <article
                className="product-card"
                key={product.id}
                id={
                  product.id === firstPackagingProductId
                    ? "pakavimas"
                    : product.id === firstGiftSetProductId
                      ? "rinkiniai"
                      : undefined
                }
              >
                <div className="product-image">
                  <button
                    type="button"
                    className="product-image-button"
                    onClick={() => {
                      setGalleryProductId(product.id);
                      setGalleryImageIndex(imageIndex);
                    }}
                    aria-label={`Padidinti „${product.name}“ nuotraukas`}
                    title="Padidinti nuotrauką"
                  >
                    <img
                      src={product.image_urls[imageIndex] || product.image}
                      alt={product.name}
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </button>

                  {product.label && (
                    <span className="product-label">{product.label}</span>
                  )}
                  <span className="product-category">{product.category}</span>
                </div>

                {product.image_urls.length > 1 && (
                  <div className="product-thumbnails">
                    {product.image_urls.map((url, index) => (
                      <button
                        key={`${url}-${index}`}
                        type="button"
                        className={
                          imageIndex === index
                            ? "product-thumb active"
                            : "product-thumb"
                        }
                        aria-label={`Rodyti ${product.name} nuotrauką ${index + 1}`}
                        aria-pressed={imageIndex === index}
                        onClick={() =>
                          setActiveImages((current) => ({
                            ...current,
                            [product.id]: index,
                          }))
                        }
                      >
                        <img src={url} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}

                <div className="product-info">
                  <div>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>

                    {product.contents.trim() && (
                      <div className="product-contents">
                        <strong className="product-contents-title">
                          Kas įeina į rinkinį
                        </strong>
                        {parseContents(product.contents).map((block, blockIndex) =>
                          block.type === "list" ? (
                            <ul
                              key={`${product.id}-block-${blockIndex}`}
                              className="product-contents-list"
                            >
                              {block.items.map((line, index) => (
                                <li key={`${product.id}-content-${blockIndex}-${index}`}>
                                  {renderInline(line)}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p
                              key={`${product.id}-block-${blockIndex}`}
                              className="product-contents-note"
                            >
                              {renderInline(block.text)}
                            </p>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  {(product.category === "Pakavimo paslaugos" || product.builder) && (
                  <div className="product-options">
                    {product.builder && (
                      <div className="build-picker">
                        <strong className="build-picker-title">
                          Pasirink produktus savo rinkiniui
                        </strong>

                        {buildCatalog.length === 0 && (
                          <p className="option-hint">Rinkinio produktų šiuo metu nėra.</p>
                        )}

                        {buildCatalog.map((entry) => {
                          const quantity = config.buildQuantities[entry.id] ?? 0;

                          const setQuantity = (next: number) =>
                            updatePackagingConfig(product.id, {
                              buildQuantities: {
                                ...config.buildQuantities,
                                [entry.id]: Math.max(0, Math.min(20, next)),
                              },
                            });

                          return (
                            <div key={entry.id} className="build-row">
                              <span className="build-row-name">{entry.name}</span>

                              <span className="build-qty">
                                <button
                                  type="button"
                                  className="build-qty-button"
                                  onClick={() => setQuantity(quantity - 1)}
                                  disabled={quantity === 0}
                                  aria-label={`Sumažinti: ${entry.name}`}
                                >
                                  −
                                </button>
                                <span className="build-qty-value">{quantity}</span>
                                <button
                                  type="button"
                                  className="build-qty-button"
                                  onClick={() => setQuantity(quantity + 1)}
                                  aria-label={`Padidinti: ${entry.name}`}
                                >
                                  +
                                </button>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {packagingOptions.length === 1 &&
                    packagingOptions[0].name !== "Kitas variantas" ? (
                      <p className="package-fixed">
                        Pasirinktas tipas: <strong>{packagingOptions[0].name}</strong>
                      </p>
                    ) : (
                      <>
                        <label htmlFor={`packaging-${product.id}`}>
                          {product.builder ? "Kokiame įpakavime norėtum rinkinio?" : "Kokio įpakavimo norėtum?"}
                        </label>

                        <select
                          id={`packaging-${product.id}`}
                          value={selectedPackagingOption?.name ?? config.packaging}
                          onChange={(event) => {
                            const selectedOption = packagingOptions.find(
                              (option) => option.name === event.target.value
                            );
                            updatePackagingConfig(product.id, {
                              packaging: event.target.value,
                              packagingOptionId:
                                selectedOption && selectedOption.id > 0 ? selectedOption.id : null,
                              packagingPrice: selectedOption?.price ?? null,
                              packagingNote:
                                event.target.value === "Kitas variantas"
                                  ? config.packagingNote
                                  : "",
                            });
                          }}
                        >
                          {packagingOptions.map((option) => (
                            <option key={option.id} value={option.name}>
                              {option.name}
                              {!product.builder && option.price !== null ? ` — + ${money(option.price)}` : ""}
                            </option>
                          ))}
                        </select>
                      </>
                    )}

                    

                    {config.packaging === "Kitas variantas" && (
                      <>
                        <label htmlFor={`packaging-note-${product.id}`}>
                          Aprašyk savo įpakavimo idėją
                        </label>

                        <textarea
                          id={`packaging-note-${product.id}`}
                          rows={2}
                          value={config.packagingNote}
                          onChange={(event) =>
                            updatePackagingConfig(product.id, {
                              packagingNote: event.target.value,
                            })
                          }
                          placeholder="Pvz., nestandartinė dėžutė, audinys, ypatingas kaspinas..."
                        />
                      </>
                    )}

                    {!product.builder && (
                      <>
                        <label htmlFor={`item-note-${product.id}`}>
                          Ką reikės supakuoti?
                        </label>

                        <textarea
                          id={`item-note-${product.id}`}
                          rows={2}
                          value={config.itemNote}
                          onChange={(event) =>
                            updatePackagingConfig(product.id, {
                              itemNote: event.target.value,
                            })
                          }
                          placeholder="Daikto pavadinimas ir apytikslis dydis, pvz., knyga A5 formato arba kosmetikos rinkinys..."
                        />
                      </>
                    )}
                  </div>
                )}

                  <div className="product-buy">
                    <strong>{money(displayedProductPrice)}</strong>

                    <button
                      className="add-button"
                      onClick={() => addToCart(product.id)}
                      aria-label={`Įdėti „${product.name}“ į krepšelį`}
                    >
                      +
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>


        <p className="catalog-note">
          Kainos ir produktų aprašymai yra pavyzdiniai. Prieš įsigyjant, pasitikrink mūsų katalogą arba susisiek su mumis ir
          mes padėsime išsirinkti.
        </p>
      </section>

      <section className="gift-banner">
        <div>
          <p className="eyebrow">ŠVENTĖMS IR MAŽOMS STAIGMENOMS</p>
          <h2>
            Dovanoti gera.
            <br />
            <em>Dovanoti gražiai – dar geriau!</em>
          </h2>
          <a
            className="button button-light"
            href="#parduotuve"
            onClick={() => setFilter("Dovanų rinkiniai")}
          >
            Peržiūrėti dovanų rinkinius <span>↗</span>
          </a>
        </div>
        <span className="banner-decoration" aria-hidden="true">♡</span>
      </section>

      <section className="section about-section" id="apie">
        <div className="about-mark">
          <img src="/logo.png" alt="" loading="lazy" />
        </div>

        <div className="about-copy">
          <p className="eyebrow">APIE GUDRUTĖS DĖŽUTES</p>
          <h2>Grožis slypi <em>detalėse</em></h2>
          <p>
            Tikime, kad dovana prasideda dar prieš ją išpakuojant.
            Nuo popieriaus tekstūros ir švelniai surišto kaspino iki
            mažos kortelės, kuri pasako daugiau nei žodžiai.
          </p>
          <p>
            Mūsų tikslas – padėti tau dovanoti lengviau, gražiau
            ir su daugiau asmeniškumo.
          </p>
          <a className="text-link" href="#kontaktai">
            Sukurkime tavo dovaną kartu ↗
          </a>
        </div>
      </section>

      <section className="quote-section">
        <span className="quote-mark">“</span>
        <p>
          Gražiausios dovanos pasako tai, ko kartais nepasako žodžiai.
        </p>
        <span className="eyebrow">GUDRUTĖS DĖŽUTĖS</span>
      </section>

      <section
        className="section cart-section"
        id="krepselis"
        aria-labelledby="cart-title"
      >
        <div className="cart-heading">
          <div>
            <p className="eyebrow">TAVO PASIRINKIMAI</p>
            <h2 id="cart-title">
              Dovanų <em>krepšelis</em>
            </h2>
          </div>
          <span className="cart-count">{cartCount} prek.</span>
        </div>

        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}

        {!cartOpen && cart.length > 0 && (
          <button
            className="text-link"
            onClick={() => setCartOpen(true)}
          >
            Peržiūrėti krepšelį ↗
          </button>
        )}

        {cart.length === 0 ? (
          <p className="empty-cart">
            Krepšelis dar tuščias. Atrask tai, kas pradžiugins.
          </p>
        ) : cartOpen ? (
          <>
            <div className="cart-items">
              {cart.map((item) => {
                const product = products.find(
                  (entry) => entry.id === item.id
                );

                if (!product) return null;

                return (
                  <div className="cart-item" key={item.lineId}>
                    <div className="cart-item-info">
                      <strong>{product.name}</strong>
                      <p>{money(getCartItemUnitPrice(product, item))} / vnt.</p>
                      {item.buildItems && item.buildItems.length > 0 && <p className="cart-config">Rinkinys: {item.buildItems.map((entry) => `${entry.name} × ${entry.quantity}`).join(", ")}</p>}
                      {item.packaging && <p className="cart-config">Įpakavimo būdas: {item.packaging}{product.builder ? "" : ` (+ ${money(item.packagingPrice ?? 0)})`}</p>}
                      {item.itemNote && <p className="cart-config">Daiktas, kurį supakuoti: {item.itemNote}</p>}
                      {item.packagingNote && <p className="cart-config">Įpakavimo idėja: {item.packagingNote}</p>}
                    </div>

                    <div className="quantity-control">
                      <button
                        onClick={() => changeQuantity(item.lineId, -1)}
                        aria-label={`Sumažinti ${product.name} kiekį`}
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        onClick={() => changeQuantity(item.lineId, 1)}
                        aria-label={`Padidinti ${product.name} kiekį`}
                      >
                        +
                      </button>
                    </div>

                    <strong className="cart-line-total">
                      {money(getCartItemUnitPrice(product, item) * item.quantity)}
                    </strong>

                    <button
                      className="remove-button"
                      onClick={() => removeFromCart(item.lineId)}
                    >
                      Pašalinti
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="cart-total">
              <span>Prekių suma</span>
              <strong>{money(cartTotal)}</strong>
            </div>

            <p className="cart-notice">
              Pristatymo kaina, jei taikoma, apskaičiuojama atskirai.
            </p>

            <a
              className="button button-dark checkout-button"
              href="#kontaktai"
              onClick={() => {
                setCartOpen(false);
                setNotice("Susisiek su mumis dėl užsakymo.");
              }}
            >
              Užklausti dėl užsakymo <span>↗</span>
            </a>

            <button
              className="text-link continue-shopping"
              onClick={() => {
                setCartOpen(false);
                document.getElementById("parduotuve")?.scrollIntoView({
                  behavior: "smooth",
                });
              }}
            >
              Tęsti apsipirkimą
            </button>
          </>
        ) : null}
      </section>

      {sitePages.length > 0 && (
        <section className="section rules-section" id="taisykles" aria-labelledby="rules-title">
          <div className="section-heading">
            <p className="eyebrow">INFORMACIJA</p>
            <h2 id="rules-title">Taisyklės ir <em>dažniausi klausimai</em></h2>
          </div>

          <div className="rules-list">
            {sitePages.map((page) => {
              const open = openPageId === page.id;

              return (
                <div className={open ? "rule-item open" : "rule-item"} key={page.id}>
                  <button
                    type="button"
                    className="rule-toggle"
                    aria-expanded={open}
                    aria-controls={`rule-body-${page.id}`}
                    onClick={() => setOpenPageId(open ? null : page.id)}
                  >
                    <span>{page.title}</span>
                    <span className="rule-icon" aria-hidden="true">{open ? "−" : "+"}</span>
                  </button>

                  {open && (
                    <div className="rule-body" id={`rule-body-${page.id}`}>
                      {renderRichText(page.body)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="contact-section" id="kontaktai">
        <div className="contact-layout">
          <div className="contact-copy">
            <p className="eyebrow">SUSISIEKIME</p>
            <h2>
              Turi idėją?
              <br />
              <em>Sukurkime ją kartu!</em>
            </h2>
            <p>
              Reikia dovanos ypatingai progai, didesnio užsakymo
              ar individualaus pakavimo? Parašyk mums.
            </p>

            <div className="contact-detail">
              <span className="contact-icon">✉</span>
              <div>
                <small>EL. PAŠTAS</small>
                <a href="mailto:info@gudrutesdezutes.lt">
                  info@gudrutesdezutes.lt
                </a>
              </div>
            </div>

            <div className="contact-detail">
              <span className="contact-icon">♡</span>
              <div>
                <small>SOCIALINIAI TINKLAI</small>
                <p>Instagram / Facebook</p>
                <span className="contact-hint">
                   
                </span>
              </div>
            </div>
          </div>

          <form className="contact-form" onSubmit={handleContactSubmit}>
            <p className="eyebrow">PARAŠYK MUMS</p>

            <label htmlFor="contact-name">Tavo vardas</label>
            <input
              id="contact-name"
              name="name"
              type="text"
              placeholder="Vardas"
              autoComplete="name"
              required
            />

            <label htmlFor="contact-email">El. paštas</label>
            <input
              id="contact-email"
              name="email"
              type="email"
              placeholder="vardas@example.com"
              autoComplete="email"
              required
            />

            <label htmlFor="contact-subject">Kuo galime padėti?</label>
            <select id="contact-subject" name="subject" defaultValue="Pakavimo paslaugos">
              <option>Pakavimo paslaugos</option>
              <option>Dovanų rinkiniai</option>
              <option>Individualus užsakymas</option>
              <option>Verslo užsakymas</option>
              <option>Kitas klausimas</option>
            </select>

            <label htmlFor="contact-message">Žinutė</label>
            <textarea
              id="contact-message"
              name="message"
              rows={4}
              placeholder="Papasakok apie savo idėją..."
              required
            />

            <button
              className="button button-dark contact-submit"
              type="submit"
              disabled={contactSending}
            >
              {contactSending ? "Siunčiama..." : "Siųsti užklausą"} <span>↗</span>
            </button>

            {contactSent && (
              <p className="form-hint" role="status">
                Ačiū! Tavo užklausa sėkmingai išsiųsta. Netrukus su tavimi susisieksime ♡
              </p>
            )}

            {contactError && (
              <p className="form-hint" role="alert">
                {contactError}
              </p>
            )}

            <p className="form-hint">
              Atsiųsdami užklausą sutinkate, kad tvarkytume jūsų pateiktus asmens duomenis tikslui atsakyti į jūsų užklausą. Daugiau apie tai skaitykite mūsų{" "}
              <a
                className="inline-link"
                href="#taisykles"
                onClick={() => {
                  const policy = sitePages.find((page) => page.slug === "privatumo-politika");
                  if (policy) setOpenPageId(policy.id);
                }}
              >
                privatumo politikoje
              </a>
              .
            </p>
          </form>
        </div>
      </section>
      
{cartOpen && (
  <div
    className="cart-drawer-layer"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        setCartOpen(false);
      }
    }}
  >
    <aside
      className="cart-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div className="drawer-header">
        <div>
          <p className="eyebrow">TAVO PASIRINKIMAI</p>
          <h2 id="drawer-title">Dovanų krepšelis <span>♡</span></h2>
        </div>

        <button
          className="drawer-close"
          onClick={() => setCartOpen(false)}
          aria-label="Uždaryti krepšelį"
        >
          ×
        </button>
      </div>

      {notice && (
        <p className="drawer-notice" role="status">
          <span>✓</span> {notice}
        </p>
      )}

      {cart.length === 0 ? (
        <div className="drawer-empty">
          <span className="empty-heart">♡</span>
          <h3>Čia prasideda dovanojimo džiaugsmas.</h3>
          <p>Tavo krepšelis kol kas tuščias.</p>
          <button
            className="button button-dark"
            onClick={() => {
              setCartOpen(false);
              document.getElementById("parduotuve")?.scrollIntoView({
                behavior: "smooth",
              });
            }}
          >
            Atrasti dovanas ↗
          </button>
        </div>
      ) : (
        <>
          <div className="drawer-items">
            {cart.map((item) => {
              const product = products.find(
                (entry) => entry.id === item.id
              );

              if (!product) return null;

              return (
                <article className="drawer-item" key={item.lineId}>
                  <div className="drawer-product-image">
                    <img
                      src={product.image}
                      alt={product.name}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </div>

                  <div className="drawer-product-details">
                    <span className="drawer-product-category">
                      {product.category}
                    </span>

                    <h3>{product.name}</h3>

                    <strong>{money(getCartItemUnitPrice(product, item))}</strong>
                    {item.buildItems && item.buildItems.length > 0 && <p className="drawer-config">Rinkinys: {item.buildItems.map((entry) => `${entry.name} × ${entry.quantity}`).join(", ")}</p>}
                      {item.packaging && <p className="drawer-config">Įpakavimo būdas: {item.packaging}{product.builder ? "" : ` (+ ${money(item.packagingPrice ?? 0)})`}</p>}
                    {item.itemNote && <p className="drawer-config">Daiktas, kurį supakuoti: {item.itemNote}</p>}
                    {item.packagingNote && <p className="drawer-config">Įpakavimo idėja: {item.packagingNote}</p>}

                    <div className="drawer-quantity">
                      <button
                        onClick={() => changeQuantity(item.lineId, -1)}
                        aria-label={`Sumažinti ${product.name} kiekį`}
                      >
                        −
                      </button>

                      <span>{item.quantity}</span>

                      <button
                        onClick={() => changeQuantity(item.lineId, 1)}
                        aria-label={`Padidinti ${product.name} kiekį`}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="drawer-item-end">
                    <strong>{money(getCartItemUnitPrice(product, item) * item.quantity)}</strong>
                    <button
                      className="drawer-remove"
                      onClick={() => removeFromCart(item.lineId)}
                      aria-label={`Pašalinti ${product.name}`}
                    >
                      Pašalinti
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="drawer-footer">
            <div className="drawer-subtotal">
              <span>Prekių suma</span>
              <strong>{money(cartTotal)}</strong>
            </div>

            <p>Pristatymą ir kontaktinius duomenis pasirinksi kitame žingsnyje.</p>

            <button
              type="button"
              className="button button-dark drawer-checkout"
              onClick={() => {
                setCheckoutError("");
                setCartOpen(false);
                setCheckoutOpen(true);
              }}
            >
              Tęsti į apmokėjimą <span>↗</span>
            </button>

            <button
              className="drawer-continue"
              onClick={() => {
                setCartOpen(false);
                setNotice("Susisiek su mumis dėl pasirinkto užsakymo.");
                document.getElementById("kontaktai")?.scrollIntoView({
                  behavior: "smooth",
                });
              }}
            >
              Turiu klausimų – parašyti žinutę
            </button>

            <button
              className="drawer-continue"
              onClick={() => {
                setCartOpen(false);
                document.getElementById("parduotuve")?.scrollIntoView({
                  behavior: "smooth",
                });
              }}
            >
              ← Tęsti apsipirkimą
            </button>
          </div>
        </>
      )}
    </aside>
  </div>
)}


{/* Atskiras užsakymo pateikimo langas */}
{checkoutOpen && (
  <div
    className="checkout-layer"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !checkoutSending) {
        setCheckoutOpen(false);
      }
    }}
  >
    <section
      className="checkout-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-title"
    >
      <div className="checkout-header">
        <div>
          <p className="eyebrow">UŽSAKYMAS</p>
          <h2 id="checkout-title">Užsakymo pateikimas <span>♡</span></h2>
        </div>

        <button
          type="button"
          className="drawer-close"
          onClick={() => setCheckoutOpen(false)}
          aria-label="Uždaryti užsakymo langą"
        >
          ×
        </button>
      </div>

      {orderPlaced ? (
        <div className="drawer-empty checkout-done">
          <span className="empty-heart">♡</span>
          <h3>Ačiū, užsakymas priimtas!</h3>
          {orderPlaced.number && (
            <p>
              Užsakymo nr. <strong>{orderPlaced.number}</strong>
            </p>
          )}
          <p>Sąskaitą apmokėjimui atsiųsime tavo nurodytu el. paštu.</p>
          <button
            type="button"
            className="button button-dark"
            onClick={() => {
              setCheckoutOpen(false);
              document.getElementById("parduotuve")?.scrollIntoView({
                behavior: "smooth",
              });
            }}
          >
            Grįžti į parduotuvę ↗
          </button>
        </div>
      ) : cart.length === 0 ? (
        <div className="drawer-empty checkout-done">
          <span className="empty-heart">♡</span>
          <h3>Krepšelis tuščias.</h3>
          <button
            type="button"
            className="button button-dark"
            onClick={() => {
              setCheckoutOpen(false);
              document.getElementById("parduotuve")?.scrollIntoView({
                behavior: "smooth",
              });
            }}
          >
            Atrasti dovanas ↗
          </button>
        </div>
      ) : (
        <div className="checkout-body">
          <form
            id="checkout-form"
            className="checkout-form"
            onSubmit={handleCheckout}
          >
            <section className="checkout-step">
              <h3>
                <span>1</span> Kontaktiniai duomenys
              </h3>

              <div className="checkout-field">
                <label htmlFor="checkout-name">Vardas ir pavardė</label>
                <input
                  id="checkout-name"
                  className="drawer-input"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                />
              </div>

              <div className="checkout-field">
                <label htmlFor="checkout-email">El. paštas</label>
                <input
                  id="checkout-email"
                  className="drawer-input"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>

              <div className="checkout-field">
                <label htmlFor="checkout-phone">
                  {deliveryNeedsPhone ? "Telefonas" : "Telefonas (nebūtina)"}
                </label>
                <input
                  id="checkout-phone"
                  className="drawer-input"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  required={deliveryNeedsPhone}
                />
              </div>
            </section>

            <section className="checkout-step">
              <h3>
                <span>2</span> Pristatymas
              </h3>

                {deliveryMethods.length > 0 && (
                  <fieldset className="delivery-picker">
                    <legend>Pristatymo būdas</legend>

                    {deliveryMethods.map((method) => (
                      <label
                        key={method.id}
                        className={
                          deliveryMethodId === method.id
                            ? "delivery-option active"
                            : "delivery-option"
                        }
                      >
                        <input
                          type="radio"
                          name="delivery_method"
                          value={method.id}
                          checked={deliveryMethodId === method.id}
                          onChange={() => {
                            setDeliveryMethodId(method.id);
                            setTerminalCity("");
                            setTerminalId("");
                            setTerminalQuery("");
                            setCheckoutError("");
                          }}
                        />
                        <span className="delivery-option-name">{method.name}</span>
                        <span className="delivery-option-price">
                          {method.price > 0 ? money(method.price) : "Nemokamai"}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}

              <div className="checkout-fields">
                {selectedDelivery?.needsTerminal &&
                  (terminalList.length > 0 ? (
                    <>
                      <input
                        className="drawer-input"
                        type="search"
                        aria-label="Paieška pagal adresą"
                        placeholder="Ieškok pagal adresą, gatvę ar pavadinimą"
                        autoComplete="off"
                        value={terminalQuery}
                        onChange={(event) => setTerminalQuery(event.target.value)}
                        onKeyDown={(event) => {
                          // Enter neturi išsiųsti viso užsakymo – jis pasirenka pirmą rastą paštomatą.
                          if (event.key === "Enter") {
                            event.preventDefault();
                            if (terminalMatches[0]) pickTerminal(terminalMatches[0]);
                          }
                        }}
                      />

                      {terminalSearchActive && (
                        <div className="terminal-results" aria-label="Paieškos rezultatai">
                          {terminalMatchesAll.length > 0 && (
                            <p className="terminal-results-count">
                              Rasta paštomatų: {terminalMatchesAll.length}
                              {terminalMatchesAll.length > terminalMatches.length
                                ? ` (rodoma ${terminalMatches.length} – patikslink paiešką)`
                                : ""}
                            </p>
                          )}
                          {terminalMatches.length === 0 ? (
                            <p className="terminal-results-empty">
                              Nieko nerasta. Pabandyk kitą adresą arba pasirink iš sąrašo žemiau.
                            </p>
                          ) : (
                            terminalMatches.map((terminal) => (
                              <button
                                type="button"
                                key={terminal.id}
                                className="terminal-result"
                                onClick={() => pickTerminal(terminal)}
                              >
                                <strong>{terminal.name}</strong>
                                <span>
                                  {terminal.address}, {terminal.city}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}

                      <p className="form-hint terminal-or">Arba pasirink iš sąrašo:</p>

                      <select
                        className="drawer-input"
                        aria-label="Miestas"
                        value={terminalCity}
                        required
                        onChange={(event) => {
                          setTerminalCity(event.target.value);
                          setTerminalId("");
                        }}
                      >
                        <option value="">Pasirink miestą</option>
                        {terminalCities.map((city) => (
                          <option key={city} value={city}>
                            {city} ({terminalCityCounts.get(city) ?? 0})
                          </option>
                        ))}
                      </select>

                      <select
                        className="drawer-input"
                        aria-label="Paštomatas"
                        value={terminalId}
                        required
                        disabled={!terminalCity}
                        onChange={(event) => setTerminalId(event.target.value)}
                      >
                        <option value="">
                          {terminalCity ? "Pasirink paštomatą" : "Pirma pasirink miestą"}
                        </option>
                        {terminalsInCity.map((terminal) => (
                          <option key={terminal.id} value={terminal.id}>
                            {terminal.name} — {terminal.address}
                          </option>
                        ))}
                      </select>

                      <input
                        type="hidden"
                        name="delivery_terminal"
                        value={
                          selectedTerminal
                            ? `${selectedTerminal.name}, ${selectedTerminal.address}, ${selectedTerminal.city}`
                            : ""
                        }
                      />
                      <input type="hidden" name="delivery_terminal_id" value={terminalId} />
                    </>
                  ) : terminalState === "loading" ? (
                    <p className="form-hint">Kraunami paštomatai...</p>
                  ) : (
                    <>
                      <input
                        key={`terminal-${selectedDelivery.id}`}
                        className="drawer-input"
                        name="delivery_terminal"
                        type="text"
                        placeholder="Paštomato pavadinimas ir adresas"
                        required
                      />
                      {terminalState === "error" && (
                        <p className="form-hint">
                          Paštomatų sąrašas šiuo metu nepasiekiamas – įrašyk paštomato pavadinimą ir adresą.
                        </p>
                      )}
                    </>
                  ))}

                {selectedDelivery?.needsAddress && (
                  <>
                    <input
                      key={`street-${selectedDelivery.id}`}
                      className="drawer-input"
                      name="delivery_street"
                      type="text"
                      placeholder="Gatvė, namo ir buto nr."
                      autoComplete="street-address"
                      required
                    />
                    <div className="drawer-input-row">
                      <input
                        key={`city-${selectedDelivery.id}`}
                        className="drawer-input"
                        name="delivery_city"
                        type="text"
                        placeholder="Miestas"
                        autoComplete="address-level2"
                        required
                      />
                      <input
                        key={`zip-${selectedDelivery.id}`}
                        className="drawer-input"
                        name="delivery_zip"
                        type="text"
                        placeholder="Pašto kodas"
                        autoComplete="postal-code"
                        required
                      />
                    </div>
                  </>
                )}
              </div>
            </section>
          </form>

          <aside className="checkout-summary" aria-label="Užsakymo santrauka">
            <h3>Tavo užsakymas</h3>

            <ul className="checkout-items">
              {cart.map((item) => {
                const product = products.find((entry) => entry.id === item.id);

                if (!product) return null;

                const unitPrice = getCartItemUnitPrice(product, item);

                return (
                  <li key={item.lineId}>
                    <div>
                      <strong>{product.name}</strong>
                      <span>
                        {item.quantity} × {money(unitPrice)}
                      </span>
                      {item.buildItems && item.buildItems.length > 0 && (
                        <span>
                          Rinkinys:{" "}
                          {item.buildItems
                            .map((entry) => `${entry.name} × ${entry.quantity}`)
                            .join(", ")}
                        </span>
                      )}
                      {item.packaging && <span>Įpakavimas: {item.packaging}</span>}
                    </div>
                    <strong>{money(unitPrice * item.quantity)}</strong>
                  </li>
                );
              })}
            </ul>

            <div className="drawer-line">
              <span>Prekių suma</span>
              <span>{money(cartTotal)}</span>
            </div>
            <div className="drawer-line">
              <span>Pristatymas</span>
              <span>
                {selectedDelivery
                  ? deliveryPrice > 0
                    ? money(deliveryPrice)
                    : "Nemokamai"
                  : "Apskaičiuojama atskirai"}
              </span>
            </div>

            <div className="drawer-subtotal">
              <span>Iš viso</span>
              <strong>{money(orderTotal)}</strong>
            </div>

            {checkoutError && (
              <p className="form-hint" role="alert">
                {checkoutError}
              </p>
            )}

            <button
              type="submit"
              form="checkout-form"
              className="button button-dark drawer-checkout"
              disabled={checkoutSending}
            >
              {checkoutSending
                ? PAYSERA_ENABLED
                  ? "Nukreipiama..."
                  : "Siunčiama..."
                : PAYSERA_ENABLED
                  ? "Apmokėti per Paysera"
                  : "Pateikti užsakymą"}{" "}
              <span>↗</span>
            </button>

            {!PAYSERA_ENABLED && (
              <p className="form-hint">
                Apmokėjimas pagal sąskaitą – sąskaitą atsiųsime el. paštu.
              </p>
            )}

            <button
              type="button"
              className="drawer-continue"
              onClick={() => {
                setCheckoutOpen(false);
                setCartOpen(true);
              }}
            >
              ← Grįžti į krepšelį
            </button>
          </aside>
        </div>
      )}
    </section>
  </div>
)}

{/* Padidinta konkrečios prekės nuotraukų galerija */}
{galleryProduct && galleryImages.length > 0
  ? createPortal(
      <div
        className="product-gallery-overlay"
        onClick={() => setGalleryProductId(null)}
      >
        <section
          className="product-gallery-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${galleryProduct.name} nuotraukų galerija`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="product-gallery-header">
            <div>
              <p className="eyebrow">NUOTRAUKŲ GALERIJA</p>
              <h2>{galleryProduct.name}</h2>
              <span>{safeGalleryImageIndex + 1} / {galleryImages.length}</span>
            </div>

            <button
              type="button"
              className="product-gallery-close"
              onClick={() => setGalleryProductId(null)}
              aria-label="Uždaryti nuotraukų galeriją"
            >
              ×
            </button>
          </div>

          <div className="product-gallery-main">
            {galleryImages.length > 1 && (
              <button
                type="button"
                className="product-gallery-arrow"
                onClick={() =>
                  setGalleryImageIndex((current) =>
                    (current - 1 + galleryImages.length) % galleryImages.length
                  )
                }
                aria-label="Ankstesnė nuotrauka"
              >
                ‹
              </button>
            )}

            <img
              src={galleryImages[safeGalleryImageIndex]}
              alt={`${galleryProduct.name} – nuotrauka ${safeGalleryImageIndex + 1}`}
              decoding="async"
            />

            {galleryImages.length > 1 && (
              <button
                type="button"
                className="product-gallery-arrow"
                onClick={() =>
                  setGalleryImageIndex((current) =>
                    (current + 1) % galleryImages.length
                  )
                }
                aria-label="Kita nuotrauka"
              >
                ›
              </button>
            )}
          </div>

          {galleryImages.length > 1 && (
            <div className="product-gallery-thumbnails">
              {galleryImages.map((url, index) => (
                <button
                  type="button"
                  key={`${url}-${index}`}
                  className={
                    safeGalleryImageIndex === index
                      ? "product-gallery-thumbnail active"
                      : "product-gallery-thumbnail"
                  }
                  onClick={() => setGalleryImageIndex(index)}
                  aria-label={`Rodyti nuotrauką ${index + 1}`}
                  aria-pressed={safeGalleryImageIndex === index}
                >
                  <img src={url} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>,
      document.body
    )
  : null}

      <footer className="footer">
        <div className="footer-main">
          <a className="brand footer-brand" href="#pradzia">
            <span>Gudrutės</span>
            <small>D Ė Ž U T Ė S</small>
          </a>

          <p>Dovanos - supakuotos su meile</p>

          <div className="footer-links">
            <a href="#paslaugos">Paslaugos</a>
            <a href="#parduotuve">Parduotuvė</a>
            {sitePages.length > 0 && <a href="#taisykles">Taisyklės</a>}
            <a href="#kontaktai">Kontaktai</a>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Gudrutės dėžutės</span>
          <a href="#pradzia">Atgal į viršų ↑</a>
       
        </div>
      </footer>
    </main>
  );
}