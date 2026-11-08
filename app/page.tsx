
"use client";

import { useState, type FormEvent } from "react";

type PackagingChoice =
  | "Popierinė dėžutė"
  | "Pintas krepšelis"
  | "Medinė dėžutė"
  | "Medžiaginis maišelis"
  | "Skaidri celofaninė / PP plėvelė"
  | "Popierius ir kaspinas"
  | "Kitas variantas";

type Product = {
  id: number;
  name: string;
  category: "Pakavimo paslaugos" | "Dovanų rinkiniai";
  price: number;
  description: string;
  image: string;
  label: string;
};

type PackagingConfig = {
  packaging: PackagingChoice;
  packagingNote: string;
  itemNote: string;
  giftCard: boolean;
  giftMessage: string;
};

type CartItem = {
  lineId: string;
  id: number;
  quantity: number;
  packaging?: PackagingChoice;
  packagingNote?: string;
  itemNote?: string;
  giftCard?: boolean;
  giftMessage?: string;
};

// Pakeisk šią sumą į tikrą palinkėjimo kortelės kainą.
const greetingCardPrice = 2.0;

// Pasirinkimai skirti PAKAVIMO PASLAUGOMS (produktai 1–3), o ne dovanų rinkiniams.
const initialPackagingConfigs: Record<number, PackagingConfig> = {
  1: {
    packaging: "Popierinė dėžutė",
    packagingNote: "",
    itemNote: "",
    giftCard: false,
    giftMessage: "",
  },
  2: {
    packaging: "Pintas krepšelis",
    packagingNote: "",
    itemNote: "",
    giftCard: false,
    giftMessage: "",
  },
  3: {
    packaging: "Popierinė dėžutė",
    packagingNote: "",
    itemNote: "",
    giftCard: false,
    giftMessage: "",
  },
};

const products: Product[] = [
  {
    id: 1,
    name: "Klasikinis įpakavimas",
    category: "Pakavimo paslaugos",
    price: 8.9,
    description: "Tavo pasirinktą daiktą supakuojame į popierinę dovanų dėžutę, papuošiame užpildu ir kaspinu.",
    image: "/images/klasikinis-pakavimas.jpg",
    label: "Kasdieniam džiaugsmui",
  },
  {
    id: 2,
    name: "Prabangus įpakavimas",
    category: "Pakavimo paslaugos",
    price: 14.9,
    description: "Dovaną estetiškai pateikiame pintame krepšelyje ir dekoruojame kaspinu. Tinka ir keliems derantiems daiktams.",
    image: "/images/prabangus-pakavimas.jpg",
    label: "Klientų pamėgtas",
  },
  {
    id: 3,
    name: "Individualus įpakavimas",
    category: "Pakavimo paslaugos",
    price: 12.9,
    description: "Vieno daikto ar ypatingos dovanos įpakavimas pagal tavo norus – nuo medinės dėžutės iki skaidrios plėvelės ir kaspino.",
    image: "/images/personalizuota-dovana.jpg",
    label: "Asmeniška",
  },
  {
    id: 4,
    name: "Klasikinis dovanų rinkinys",
    category: "Dovanų rinkiniai",
    price: 34.9,
    description: "Kruopščiai suderinta dovana, supakuota į elegantišką popierinę dėžutę.",
    image: "/images/kaledu-jaukumo-rinkinys.jpg",
    label: "Dovanai paruošta",
  },
  {
    id: 5,
    name: "Personalizuotas dovanų rinkinys",
    category: "Dovanų rinkiniai",
    price: 29.9,
    description: "Rinkinys pagal tavo norus – pasirink turinį, įpakavimą ir aprašyk savo idėją.",
    image: "/images/saldziu-akimirku-rinkinys.jpg",
    label: "Sukurtas pagal tave",
  },
  {
    id: 6,
    name: "Prabangus dovanų rinkinys",
    category: "Dovanų rinkiniai",
    price: 49.9,
    description: "Išskirtinis dovanų rinkinys, estetiškai sudėtas į pintą krepšelį.",
    image: "/images/prabangus-dovanu-rinkinys.jpg",
    label: "Ypatingai progai",
  },
];

const categories = [
  "Pakavimo paslaugos",
  "Dovanų rinkiniai",
  "Visos prekės",
] as const;

type Category = (typeof categories)[number];

const money = (amount: number) =>
  new Intl.NumberFormat("lt-LT", {
    style: "currency",
    currency: "EUR",
  }).format(amount);

export default function Home() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [packagingConfigs, setPackagingConfigs] = useState<Record<number, PackagingConfig>>(initialPackagingConfigs);
  const [filter, setFilter] = useState<Category>("Pakavimo paslaugos");
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);
  const [contactError, setContactError] = useState("");

  const visibleProducts = products.filter(
    (product) =>
      filter === "Visos prekės" || product.category === filter
  );

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const cartTotal = cart.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.id);
    const unitPrice = (product?.price ?? 0) + (item.giftCard ? greetingCardPrice : 0);
    return sum + unitPrice * item.quantity;
  }, 0);

  function updatePackagingConfig(id: number, changes: Partial<PackagingConfig>) {
    setPackagingConfigs((current) => ({
      ...current,
      [id]: { ...current[id], ...changes },
    }));
  }

  function addToCart(id: number) {
    const product = products.find((item) => item.id === id);
    if (!product) return;

    // Konfigūracija taikoma tik trims pakavimo paslaugoms, ne dovanų rinkiniams.
    const config = product.category === "Pakavimo paslaugos" ? packagingConfigs[id] : undefined;

    if (config && !config.itemNote.trim()) {
      setNotice("Parašyk, kokį daiktą reikės supakuoti ir nurodyk apytikslį jo dydį.");
      return;
    }

    if (config?.packaging === "Kitas variantas" && !config.packagingNote.trim()) {
      setNotice("Aprašyk, kokio individualaus įpakavimo norėtum.");
      return;
    }

    if (config?.giftCard && !config.giftMessage.trim()) {
      setNotice("Įrašyk palinkėjimo tekstą arba nuimk kortelės pasirinkimą.");
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

      const unitPrice = product.price + (item.giftCard ? greetingCardPrice : 0);
      const details = [
        item.packaging ? `Įpakavimas: ${item.packaging}` : "",
        item.packagingNote ? `Papildoma įpakavimo idėja: ${item.packagingNote}` : "",
        item.itemNote ? `Daiktas, kurį reikia supakuoti: ${item.itemNote}` : "",
        item.giftCard ? `Mokama palinkėjimo kortelė: ${item.giftMessage || "Tekstas nenurodytas"}` : "",
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
          <a className="service-card service-one" href="#pakavimas">
            <span className="service-number">01 / PASLAUGA</span>
            <div>
              <h3>Dovanų pakavimas</h3>
              <p>
                Supakuojame tavo atneštą ar pasirinktą daiktą – nuo popierinės dėžutės iki individualaus sprendimo.
              </p>
              <span className="text-link">Atrasti pakavimo paslaugas ↗</span>
            </div>
          </a>

          <a className="service-card service-two" href="#rinkiniai">
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

        <div className="product-grid">
          {visibleProducts.map((product) => (
            <article
              className="product-card"
              key={product.id}
              id={product.id === 1 ? "pakavimas" : product.id === 4 ? "rinkiniai" : undefined}
            >
              <div className="product-image">
                <img
                  src={product.image}
                  alt={product.name}
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
                <span className="product-label">{product.label}</span>
                <span className="product-category">{product.category}</span>
              </div>

              <div className="product-info">
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.description}</p>
                </div>

                {product.category === "Pakavimo paslaugos" && (
                  <div className="product-options">
                    {product.id === 1 && (
                      <p className="package-fixed">Pasirinktas tipas: <strong>popierinė dovanų dėžutė</strong></p>
                    )}
                    {product.id === 2 && (
                      <p className="package-fixed">Pasirinktas tipas: <strong>pintas krepšelis</strong></p>
                    )}
                    {product.id === 3 && (
                      <>
                        <label htmlFor={`packaging-${product.id}`}>Kokio įpakavimo norėtum?</label>
                        <select
                          id={`packaging-${product.id}`}
                          value={packagingConfigs[product.id].packaging}
                          onChange={(event) => updatePackagingConfig(product.id, {
                            packaging: event.target.value as PackagingChoice,
                            packagingNote: event.target.value === "Kitas variantas" ? packagingConfigs[product.id].packagingNote : "",
                          })}
                        >
                          <option value="Popierinė dėžutė">Popierinė dėžutė</option>
                          <option value="Pintas krepšelis">Pintas krepšelis</option>
                          <option value="Medinė dėžutė">Medinė dėžutė</option>
                          <option value="Medžiaginis maišelis">Medžiaginis maišelis</option>
                          <option value="Skaidri celofaninė / PP plėvelė">Skaidri celofaninė / PP plėvelė</option>
                          <option value="Popierius ir kaspinas">Popierius ir kaspinas</option>
                          <option value="Kitas variantas">Kitas variantas</option>
                        </select>
                        {packagingConfigs[product.id].packaging === "Kitas variantas" && (
                          <>
                            <label htmlFor={`packaging-note-${product.id}`}>Aprašyk savo įpakavimo idėją</label>
                            <textarea
                              id={`packaging-note-${product.id}`}
                              rows={2}
                              value={packagingConfigs[product.id].packagingNote}
                              onChange={(event) => updatePackagingConfig(product.id, {
                                packagingNote: event.target.value,
                              })}
                              placeholder="Pvz., nestandartinė dėžutė, audinys, ypatingas kaspinas..."
                            />
                          </>
                        )}
                      </>
                    )}

                    <label htmlFor={`item-note-${product.id}`}>Ką reikės supakuoti?</label>
                    <textarea
                      id={`item-note-${product.id}`}
                      rows={2}
                      value={packagingConfigs[product.id].itemNote}
                      onChange={(event) => updatePackagingConfig(product.id, {
                        itemNote: event.target.value,
                      })}
                      placeholder="Daikto pavadinimas ir apytikslis dydis, pvz., knyga  A5 formato arba kosmetikos rinkinys..."
                    />

                    <label className="gift-card-toggle">
                      <input
                        type="checkbox"
                        checked={packagingConfigs[product.id].giftCard}
                        onChange={(event) => updatePackagingConfig(product.id, {
                          giftCard: event.target.checked,
                          giftMessage: event.target.checked ? packagingConfigs[product.id].giftMessage : "",
                        })}
                      />
                      Pridėti palinkėjimo kortelę (+ {money(greetingCardPrice)})
                    </label>

                    {packagingConfigs[product.id].giftCard && (
                      <>
                        <label htmlFor={`greeting-${product.id}`}>Tavo palinkėjimas</label>
                        <textarea
                          id={`greeting-${product.id}`}
                          rows={2}
                          required
                          value={packagingConfigs[product.id].giftMessage}
                          onChange={(event) => updatePackagingConfig(product.id, {
                            giftMessage: event.target.value,
                          })}
                          placeholder="Parašyk savo žodžius..."
                        />
                        <small className="option-hint">Pvz., „Su meile ir šilčiausiais linkėjimais!“ arba „Tegul ši dovana atneša daug džiaugsmo.“</small>
                      </>
                    )}
                  </div>
                )}

                <div className="product-buy">
                  <strong>{money(product.price)}</strong>
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
          ))}
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
          <a className="button button-light" href="#rinkiniai">
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
                      <p>{money(product.price + (item.giftCard ? greetingCardPrice : 0))} / vnt.</p>
                      {item.packaging && <p className="cart-config">Įpakavimo būdas: {item.packaging}</p>}
                      {item.itemNote && <p className="cart-config">Daiktas, kurį supakuoti: {item.itemNote}</p>}
                      {item.packagingNote && <p className="cart-config">Įpakavimo idėja: {item.packagingNote}</p>}
                      {item.giftCard && <p className="cart-config">Palinkėjimo kortelė: „{item.giftMessage}“</p>}
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
                      {money((product.price + (item.giftCard ? greetingCardPrice : 0)) * item.quantity)}
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
              Šiuo metu tai demonstracinis krepšelis.
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
                   svetainė.
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

                    <strong>{money(product.price + (item.giftCard ? greetingCardPrice : 0))}</strong>
                    {item.packaging && <p className="drawer-config">Įpakavimo būdas: {item.packaging}</p>}
                    {item.itemNote && <p className="drawer-config">Daiktas, kurį supakuoti: {item.itemNote}</p>}
                    {item.packagingNote && <p className="drawer-config">Įpakavimo idėja: {item.packagingNote}</p>}
                    {item.giftCard && <p className="drawer-config">Kortelė: „{item.giftMessage}“</p>}

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
                    <strong>{money((product.price + (item.giftCard ? greetingCardPrice : 0)) * item.quantity)}</strong>
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

            <button
              className="button button-dark drawer-checkout"
              onClick={() => {
                setCartOpen(false);
                setNotice("Susisiek su mumis dėl pasirinkto užsakymo.");
                document.getElementById("kontaktai")?.scrollIntoView({
                  behavior: "smooth",
                });
              }}
            >
              Užklausti dėl užsakymo <span>↗</span>
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
