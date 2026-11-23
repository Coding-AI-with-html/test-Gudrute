"use client";

import {
  useState,
  useEffect,
  useMemo,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";

import { createSupabaseClient } from "@/lib/supabase/client";
import {
  type PackagingChoice,
  type PackagingOption,
} from "@/lib/products";

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
  };
}

// Galutinė kaina = produkto kaina + pasirinkto pakavimo būdo kaina.
// Jei pakavimo būdo kaina nenustatyta, prie produkto kainos nieko nepridedama.
function getCartItemUnitPrice(product: Product, item: CartItem): number {
  const packagingPrice =
    product.category === "Pakavimo paslaugos" ? item.packagingPrice ?? 0 : 0;

  return product.price + packagingPrice;
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

export default function Home() {
  
  const supabase = useMemo(() => createSupabaseClient(), []);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");

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

  // Jei klientas grįžta atgal iš Paysera puslapio, mygtukas vėl tampa aktyvus.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) setCheckoutSending(false);
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

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
        ] = await Promise.all([
          supabase
            .from("products")
            .select(
              "id, name, category, price, description, contents, image_urls, label, packaging_mode, packaging_choices"
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
        ]);

        if (error) throw error;
        if (linksError) throw new Error(`Nepavyko įkelti produktų pakavimo būdų: ${linksError.message}`);
        if (optionsError) throw new Error(`Nepavyko įkelti pakavimo būdų katalogo: ${optionsError.message}`);

        if (!active) return;

        type ProductRow = {
          id: number;
          name: string;
          category: Product["category"];
          price: number | string;
          description: string;
          contents: string | null;
          image_urls: string[] | null;
          label: string | null;
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
            packaging_mode: row.packaging_mode ?? "none",
            packaging_choices: row.packaging_choices ?? [],
            packaging_options: optionsByProduct.get(Number(row.id)) ?? [],
          };
        });

        setProducts(mappedProducts);

        setPackagingConfigs((current) => {
          const next = { ...current };

          mappedProducts.forEach((product) => {
            if (product.category !== "Pakavimo paslaugos") return;

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

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const cartTotal = cart.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.id);
    const unitPrice = product ? getCartItemUnitPrice(product, item) : 0;
    return sum + unitPrice * item.quantity;
  }, 0);

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

    // Konfigūracija taikoma tik trims pakavimo paslaugoms, ne dovanų rinkiniams.
    const config =
    product.category === "Pakavimo paslaugos"
      ? packagingConfigs[id] ?? createPackagingConfig(product)
      : undefined;

    if (config && !config.itemNote.trim()) {
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
        ...(config ?? {}),
      },
    ]);

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
  // sukuria užsakymą ir grąžina Paysera mokėjimo nuorodą.
  async function handleCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (cart.length === 0 || checkoutSending) return;

    const data = new FormData(event.currentTarget);

    setCheckoutSending(true);
    setCheckoutError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: String(data.get("name") ?? "").trim(),
            email: String(data.get("email") ?? "").trim(),
            phone: String(data.get("phone") ?? "").trim(),
          },
          items: cart.map((item) => ({
            productId: item.id,
            quantity: item.quantity,
            packagingOptionId: item.packagingOptionId ?? null,
            packaging: item.packaging ?? null,
            itemNote: item.itemNote ?? "",
            packagingNote: item.packagingNote ?? "",
          })),
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.url) {
        throw new Error(result.error || "Nepavyko pradėti apmokėjimo. Bandyk dar kartą.");
      }

      // Nukreipiame į Paysera apmokėjimo puslapį.
      window.location.href = result.url;
    } catch (error) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "Nepavyko pradėti apmokėjimo. Patikrink interneto ryšį ir bandyk dar kartą."
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
        item.packaging
          ? `Įpakavimas: ${item.packaging} (+ ${money(item.packagingPrice ?? 0)})`
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
              (product.category === "Pakavimo paslaugos" ? selectedPackagingPrice : 0);

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

                  <span className="product-label">{product.label}</span>
                  <span className="product-category">{product.category}</span>
                </div>

                {product.image_urls.length > 1 && (
                  <div
                    className="product-thumbnails"
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      margin: "10px 0",
                    }}
                  >
                    {product.image_urls.map((url, index) => (
                      <button
                        key={`${url}-${index}`}
                        type="button"
                        aria-label={`Rodyti ${product.name} nuotrauką ${index + 1}`}
                        onClick={() =>
                          setActiveImages((current) => ({
                            ...current,
                            [product.id]: index,
                          }))
                        }
                        style={{
                          padding: 0,
                          background: "transparent",
                          border:
                            imageIndex === index
                              ? "2px solid #292722"
                              : "1px solid #ddd",
                          borderRadius: 8,
                          overflow: "hidden",
                        }}
                      >
                        <img
                          src={url}
                          alt=""
                          style={{
                            display: "block",
                            width: 55,
                            height: 55,
                            objectFit: "cover",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                )}

                <div className="product-info">
                  <div>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>

                    {product.contents.trim() && (
                      <div
                        className="product-contents"
                        style={{
                          marginTop: 14,
                          paddingTop: 12,
                          borderTop: "1px solid #e5e0d7",
                          fontSize: 14,
                          lineHeight: 1.5,
                        }}
                      >
                        <strong
                          style={{
                            display: "block",
                            marginBottom: 6,
                            fontSize: 12,
                            letterSpacing: 1.5,
                            textTransform: "uppercase",
                          }}
                        >
                          Kas įeina į rinkinį
                        </strong>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {product.contents
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean)
                            .map((line, index) => (
                              <li key={`${product.id}-content-${index}`}>{line}</li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {product.category === "Pakavimo paslaugos" && (
                  <div className="product-options">
                    {packagingOptions.length === 1 &&
                    packagingOptions[0].name !== "Kitas variantas" ? (
                      <p className="package-fixed">
                        Pasirinktas tipas: <strong>{packagingOptions[0].name}</strong>
                      </p>
                    ) : (
                      <>
                        <label htmlFor={`packaging-${product.id}`}>
                          Kokio įpakavimo norėtum?
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
                              {option.price !== null ? ` — + ${money(option.price)}` : ""}
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
                      {item.packaging && <p className="cart-config">Įpakavimo būdas: {item.packaging} (+ {money(item.packagingPrice ?? 0)})</p>}
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
              Atsiųsdami užklausą sutinkate, kad tvarkytume jūsų pateiktus asmens duomenis tikslui atsakyti į jūsų užklausą. Daugiau apie tai skaitykite mūsų privatumo politikoje.
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
                    {item.packaging && <p className="drawer-config">Įpakavimo būdas: {item.packaging} (+ {money(item.packagingPrice ?? 0)})</p>}
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

            <p>Pristatymo kaina, jei taikoma, apskaičiuojama atskirai.</p>

            <form
              className="drawer-checkout-form"
              onSubmit={handleCheckout}
              style={{ display: "grid", gap: 8, margin: "12px 0" }}
            >
              {[
                { name: "name", type: "text", placeholder: "Vardas", autoComplete: "name", required: true },
                { name: "email", type: "email", placeholder: "El. paštas", autoComplete: "email", required: true },
                { name: "phone", type: "tel", placeholder: "Telefonas (nebūtina)", autoComplete: "tel", required: false },
              ].map((field) => (
                <input
                  key={field.name}
                  name={field.name}
                  type={field.type}
                  placeholder={field.placeholder}
                  autoComplete={field.autoComplete}
                  required={field.required}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: 12,
                    border: "1px solid #d8d3ca",
                    borderRadius: 9,
                    background: "white",
                    color: "#292722",
                    font: "inherit",
                  }}
                />
              ))}

              <button
                type="submit"
                className="button button-dark drawer-checkout"
                disabled={checkoutSending}
              >
                {checkoutSending ? "Nukreipiama..." : "Apmokėti per Paysera"} <span>↗</span>
              </button>

              {checkoutError && (
                <p className="form-hint" role="alert">
                  {checkoutError}
                </p>
              )}
            </form>

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