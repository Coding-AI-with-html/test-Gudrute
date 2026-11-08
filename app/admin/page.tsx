
"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";

type Product = {
  id: number;
  name: string;
  category: "Pakavimo paslaugos" | "Dovanų rinkiniai";
  price: number;
  description: string;
  image_urls: string[];
  label: string;
  is_active: boolean;
  sort_order: number;
  packaging_mode: "none" | "fixed_paper_box" | "fixed_basket" | "custom";
};

type EditorForm = {
  name: string;
  category: Product["category"];
  price: string;
  description: string;
  label: string;
  image_urls: string[];
  is_active: boolean;
  sort_order: string;
  packaging_mode: Product["packaging_mode"];
};

const emptyForm: EditorForm = {
  name: "",
  category: "Dovanų rinkiniai",
  price: "",
  description: "",
  label: "",
  image_urls: [],
  is_active: true,
  sort_order: "0",
  packaging_mode: "none",
};

function getStoragePath(url: string): string | null {
  const marker = "/storage/v1/object/public/product-images/";
  const index = url.indexOf(marker);

  return index >= 0
    ? decodeURIComponent(url.slice(index + marker.length))
    : null;
}

function money(value: number) {
  return new Intl.NumberFormat("lt-LT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default function AdminPage() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const adminUid = process.env.NEXT_PUBLIC_ADMIN_UID;

  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<EditorForm>(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      setError("Nepavyko įkelti produktų: " + error.message);
      return;
    }

    setProducts((data ?? []) as Product[]);
  }, [supabase]);

  useEffect(() => {
    let alive = true;

    async function checkSession() {
      if (!adminUid) {
        setError("Trūksta NEXT_PUBLIC_ADMIN_UID nustatymo.");
        setChecking(false);
        return;
      }

      const { data, error } = await supabase.auth.getSession();

      if (!alive) return;

      if (error) {
        setError(error.message);
      } else if (data.session?.user.id === adminUid) {
        setIsAdmin(true);
        await loadProducts();
      } else if (data.session) {
        await supabase.auth.signOut();
      }

      if (alive) setChecking(false);
    }

    void checkSession();

    return () => {
      alive = false;
    };
  }, [supabase, adminUid, loadProducts]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!adminUid) {
        throw new Error("Nenurodytas administratoriaus UID.");
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      if (data.user.id !== adminUid) {
        await supabase.auth.signOut();
        throw new Error("Ši paskyra neturi administratoriaus teisių.");
      }

      setIsAdmin(true);
      setPassword("");
      setMessage("Sėkmingai prisijungei!");
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prisijungti nepavyko.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setProducts([]);
    setMessage("");
    setError("");
  }

  

async function handleForgotPassword() {
  setError("");
  setMessage("");

  if (!email.trim()) {
    setError("Pirmiausia įrašyk savo el. pašto adresą.");
    return;
  }

  setLoading(true);

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: "https://gudrutesdezutes.lt/reset-password",
      }
    );

    if (error) throw error;

    setMessage(
      "Jeigu šis el. paštas registruotas, išsiuntėme slaptažodžio atkūrimo laišką. Patikrink paštą."
    );
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Nepavyko išsiųsti atkūrimo laiško."
    );
  } finally {
    setLoading(false);
  }
}



  function startEdit(product: Product) {
    setEditingId(product.id);
    setFiles([]);

    setForm({
      name: product.name,
      category: product.category,
      price: String(product.price),
      description: product.description,
      label: product.label ?? "",
      image_urls: product.image_urls ?? [],
      is_active: product.is_active,
      sort_order: String(product.sort_order ?? 0),
      packaging_mode: product.packaging_mode ?? "none",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setFiles([]);
    setForm({ ...emptyForm });
  }

  async function uploadImages(selectedFiles: File[]) {
    const urls: string[] = [];
    const paths: string[] = [];

    for (const file of selectedFiles) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error("Galima įkelti tik JPG, PNG arba WEBP nuotraukas.");
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error(`Nuotrauka „${file.name}“ viršija 5 MB limitą.`);
      }

      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${crypto.randomUUID()}.${extension}`;

      const { data, error } = await supabase.storage
        .from("product-images")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });

      if (error) {
        if (paths.length) {
          await supabase.storage.from("product-images").remove(paths);
        }
        throw error;
      }

      paths.push(data.path);

      const { data: publicData } = supabase.storage
        .from("product-images")
        .getPublicUrl(data.path);

      urls.push(publicData.publicUrl);
    }

    return { urls, paths };
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const price = Number(form.price.replace(",", "."));

    if (!form.name.trim()) {
      setError("Įrašyk produkto pavadinimą.");
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setError("Įrašyk teisingą kainą.");
      return;
    }

    if (!form.description.trim()) {
      setError("Įrašyk produkto aprašymą.");
      return;
    }

    if (!form.image_urls.length && !files.length) {
      setError("Pridėk bent vieną produkto nuotrauką.");
      return;
    }

    setLoading(true);

    let uploadedPaths: string[] = [];

    try {
      const uploaded = await uploadImages(files);
      uploadedPaths = uploaded.paths;

      const imageUrls = [...form.image_urls, ...uploaded.urls];

      const payload = {
        name: form.name.trim(),
        category: form.category,
        price,
        description: form.description.trim(),
        label: form.label.trim(),
        image_urls: imageUrls,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
        packaging_mode:
          form.category === "Dovanų rinkiniai"
            ? "none"
            : form.packaging_mode,
        updated_at: new Date().toISOString(),
      };

      let saveError;

      if (editingId !== null) {
        const result = await supabase
          .from("products")
          .update(payload)
          .eq("id", editingId);

        saveError = result.error;
      } else {
        const result = await supabase
          .from("products")
          .insert(payload);

        saveError = result.error;
      }

      if (saveError) {
        if (uploadedPaths.length) {
          await supabase.storage.from("product-images").remove(uploadedPaths);
        }
        throw saveError;
      }

      if (editingId !== null) {
        const oldProduct = products.find((p) => p.id === editingId);

        const removedPaths = (oldProduct?.image_urls ?? [])
          .filter((url) => !imageUrls.includes(url))
          .map(getStoragePath)
          .filter((path): path is string => Boolean(path));

        if (removedPaths.length) {
          const { error: removeError } = await supabase.storage
            .from("product-images")
            .remove(removedPaths);

          if (removeError) {
            setMessage("Produktas išsaugotas, bet kai kurių senų nuotraukų nepavyko pašalinti.");
          }
        }
      }

      if (!message) {
        setMessage(editingId === null
          ? "Produktas sėkmingai pridėtas!"
          : "Produktas sėkmingai atnaujintas!");
      }

      resetForm();
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nepavyko išsaugoti produkto.");

      if (uploadedPaths.length) {
        await supabase.storage.from("product-images").remove(uploadedPaths);
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggleProduct(product: Product) {
    setError("");
    setMessage("");

    const { error } = await supabase
      .from("products")
      .update({ is_active: !product.is_active })
      .eq("id", product.id);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(product.is_active ? "Produktas paslėptas." : "Produktas vėl rodomas.");
    await loadProducts();
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`Ar tikrai ištrinti „${product.name}“?`)) return;

    setError("");
    setMessage("");

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id);

    if (error) {
      setError(error.message);
      return;
    }

    const paths = (product.image_urls ?? [])
      .map(getStoragePath)
      .filter((path): path is string => Boolean(path));

    if (paths.length) {
      const { error: imageError } = await supabase.storage
        .from("product-images")
        .remove(paths);

      if (imageError) {
        setMessage("Produktas ištrintas, bet kai kurių nuotraukų nepavyko pašalinti.");
      }
    }

    setMessage("Produktas ištrintas.");
    await loadProducts();

    if (editingId === product.id) resetForm();
  }

  if (checking) {
    return <main className="admin-page">Tikrinama prisijungimo būsena...</main>;
  }

  if (!isAdmin) {
    return (
      <main className="admin-page">
        <section className="admin-login">
          <p className="admin-eyebrow">GUDRUTĖS DĖŽUTĖS</p>
          <h1>Administratoriaus prisijungimas</h1>
          <p>Prisijunk, kad galėtum valdyti produktus.</p>

          <form onSubmit={handleLogin}>
            <label htmlFor="admin-email">El. paštas</label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />

            <label htmlFor="admin-password">Slaptažodis</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />

            <button disabled={loading}>
              {loading ? "Jungiamasi..." : "Prisijungti"}
            </button>
          </form>
          
            <button
            type="button"
            className="secondary"
            onClick={handleForgotPassword}
            disabled={loading}
            >
            Pamiršau slaptažodį
            </button>

            {message && <p className="admin-success">{message}</p>}
            {error && <p className="admin-error">{error}</p>}


          {error && <p className="admin-error">{error}</p>}
          <a href="/">Grįžti į svetainę</a>
        </section>

        <AdminStyles />
      </main>
    );
  }

  return (
    <main className="admin-page">
      <div className="admin-container">
        <header className="admin-header">
          <div>
            <p className="admin-eyebrow">GUDRUTĖS DĖŽUTĖS</p>
            <h1>Produktų administravimas</h1>
            <p>Pridėk, redaguok arba paslėpk savo produktus.</p>
          </div>
          <div className="admin-header-actions">
            <a href="/" target="_blank" rel="noreferrer">Peržiūrėti svetainę ↗</a>
            <button type="button" className="secondary" onClick={handleLogout}>
              Atsijungti
            </button>
          </div>
        </header>

        {message && <p className="admin-success">{message}</p>}
        {error && <p className="admin-error">{error}</p>}

        <section className="admin-panel">
          <h2>{editingId === null ? "Pridėti naują produktą" : "Redaguoti produktą"}</h2>

          <form onSubmit={handleSave} className="admin-form">
            <label>
              Produkto pavadinimas
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>

            <div className="admin-two-columns">
              <label>
                Kategorija
                <select
                  value={form.category}
                  onChange={(e) => {
                    const category = e.target.value as Product["category"];
                    setForm({
                      ...form,
                      category,
                      packaging_mode: category === "Pakavimo paslaugos" ? "custom" : "none",
                    });
                  }}
                >
                  <option>Pakavimo paslaugos</option>
                  <option>Dovanų rinkiniai</option>
                </select>
              </label>

              <label>
                Kaina (€)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                />
              </label>
            </div>

            {form.category === "Pakavimo paslaugos" && (
              <label>
                Pakavimo pasirinkimas
                <select
                  value={form.packaging_mode}
                  onChange={(e) => setForm({
                    ...form,
                    packaging_mode: e.target.value as Product["packaging_mode"],
                  })}
                >
                  <option value="fixed_paper_box">Popierinė dėžutė</option>
                  <option value="fixed_basket">Pintas krepšelis</option>
                  <option value="custom">Individualus pasirinkimas</option>
                </select>
              </label>
            )}

            <label>
              Trumpa etiketė (nebūtina)
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Pvz., Klientų pamėgtas"
              />
            </label>

            <label>
              Aprašymas
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
              />
            </label>

            <label>
              Nuotraukos (JPG, PNG arba WEBP, iki 5 MB kiekviena)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </label>

            {files.length > 0 && (
              <p className="admin-help">Pasirinkta naujų nuotraukų: {files.length}</p>
            )}

            {form.image_urls.length > 0 && (
              <div className="admin-image-list">
                {form.image_urls.map((url, index) => (
                  <div className="admin-image" key={`${url}-${index}`}>
                    <img src={url} alt={`Produkto nuotrauka ${index + 1}`} />
                    <button
                      type="button"
                      onClick={() => setForm({
                        ...form,
                        image_urls: form.image_urls.filter((_, i) => i !== index),
                      })}
                    >
                      Pašalinti
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="admin-two-columns">
              <label>
                Rikiavimo numeris
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                />
              </label>

              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Rodyti svetainėje
              </label>
            </div>

            <div className="admin-form-actions">
              <button disabled={loading}>
                {loading
                  ? "Saugoma..."
                  : editingId === null
                    ? "Pridėti produktą"
                    : "Išsaugoti pakeitimus"}
              </button>

              {editingId !== null && (
                <button type="button" className="secondary" onClick={resetForm}>
                  Atšaukti redagavimą
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="admin-panel">
          <div className="admin-list-heading">
            <h2>Produktai ({products.length})</h2>
            <button type="button" className="secondary" onClick={loadProducts}>
              Atnaujinti sąrašą
            </button>
          </div>

          {products.length === 0 ? (
            <p>Produktų dar nėra.</p>
          ) : (
            <div className="admin-products">
              {products.map((product) => (
                <article className="admin-product" key={product.id}>
                  {product.image_urls?.[0] ? (
                    <img src={product.image_urls[0]} alt={product.name} />
                  ) : (
                    <div className="admin-no-image">Be nuotraukos</div>
                  )}

                  <div className="admin-product-details">
                    <span className="admin-help">{product.category}</span>
                    <h3>{product.name}</h3>
                    <strong>{money(product.price)}</strong>
                    <span className={product.is_active ? "status active" : "status hidden"}>
                      {product.is_active ? "Rodomas svetainėje" : "Paslėptas"}
                    </span>
                  </div>

                  <div className="admin-product-actions">
                    <button type="button" className="secondary" onClick={() => startEdit(product)}>
                      Redaguoti
                    </button>
                    <button type="button" className="secondary" onClick={() => toggleProduct(product)}>
                      {product.is_active ? "Paslėpti" : "Rodyti"}
                    </button>
                    <button type="button" className="danger" onClick={() => deleteProduct(product)}>
                      Ištrinti
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <AdminStyles />
    </main>
  );
}

function AdminStyles() {
  return (
    <style jsx global>{`
      .admin-page {
        min-height: 100vh;
        background: #f7f5f1;
        color: #292722;
        padding: 36px 18px;
        font-family: Arial, sans-serif;
      }
      .admin-container { max-width: 1050px; margin: 0 auto; }
      .admin-login {
        max-width: 420px; margin: 8vh auto; background: white;
        padding: 36px; border-radius: 18px; box-shadow: 0 8px 35px #0000000d;
      }
      .admin-login form, .admin-form { display: grid; gap: 14px; }
      .admin-login label, .admin-form label {
        display: grid; gap: 7px; font-size: 14px; font-weight: 600;
      }
      .admin-page input:not([type="checkbox"]),
      .admin-page select, .admin-page textarea {
        width: 100%; box-sizing: border-box; padding: 12px;
        border: 1px solid #d8d3ca; border-radius: 9px;
        background: white; color: #292722; font: inherit;
      }
      .admin-page button {
        border: 0; border-radius: 9px; padding: 12px 17px;
        background: #292722; color: white; cursor: pointer; font: inherit;
      }
      .admin-page button:disabled { opacity: .6; cursor: wait; }
      .admin-page button.secondary {
        background: white; color: #292722; border: 1px solid #d8d3ca;
      }
      .admin-page button.danger { background: #9c3838; }
      .admin-eyebrow { letter-spacing: 3px; font-size: 11px; color: #897c68; }
      .admin-header, .admin-header-actions, .admin-list-heading {
        display: flex; align-items: center; justify-content: space-between; gap: 15px;
      }
      .admin-header { margin-bottom: 25px; }
      .admin-header h1 { font-size: clamp(25px, 4vw, 36px); margin: 5px 0; }
      .admin-header p { color: #777; }
      .admin-header-actions { flex-wrap: wrap; }
      .admin-header-actions a, .admin-login a { color: #66543b; }
      .admin-panel {
        background: white; padding: 25px; border-radius: 16px;
        margin: 20px 0; box-shadow: 0 5px 25px #00000008;
      }
      .admin-panel h2 { font-size: 21px; margin: 0 0 20px; }
      .admin-two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
      .admin-checkbox { display: flex !important; align-items: center; gap: 10px !important; }
      .admin-checkbox input { width: 18px; height: 18px; }
      .admin-form-actions { display: flex; gap: 10px; flex-wrap: wrap; }
      .admin-image-list { display: flex; gap: 12px; flex-wrap: wrap; }
      .admin-image { width: 115px; }
      .admin-image img { width: 115px; height: 100px; object-fit: cover; border-radius: 8px; }
      .admin-image button { width: 100%; margin-top: 5px; padding: 7px; font-size: 12px; background: #8b4141; }
      .admin-help { color: #81796d; font-size: 12px; }
      .admin-products { display: grid; gap: 12px; }
      .admin-product {
        display: grid; grid-template-columns: 95px 1fr auto; gap: 15px;
        align-items: center; border: 1px solid #eeeae3; padding: 12px; border-radius: 12px;
      }
      .admin-product > img, .admin-no-image {
        width: 95px; height: 95px; object-fit: cover; border-radius: 8px;
      }
      .admin-no-image { display: grid; place-items: center; background: #eeeae3; font-size: 11px; }
      .admin-product h3 { margin: 5px 0; }
      .admin-product-details { display: grid; gap: 5px; }
      .status { font-size: 12px; }
      .status.active { color: #28764b; }
      .status.hidden { color: #a36a26; }
      .admin-product-actions { display: flex; flex-wrap: wrap; gap: 7px; }
      .admin-product-actions button { padding: 9px 11px; font-size: 12px; }
      .admin-error, .admin-success { padding: 12px; border-radius: 8px; }
      .admin-error { background: #fae9e7; color: #922d26; }
      .admin-success { background: #e8f4ec; color: #24663e; }
      @media (max-width: 700px) {
        .admin-header { align-items: flex-start; flex-direction: column; }
        .admin-two-columns { grid-template-columns: 1fr; }
        .admin-product { grid-template-columns: 75px 1fr; }
        .admin-product > img, .admin-no-image { width: 75px; height: 75px; }
        .admin-product-actions { grid-column: 1 / -1; }
        .admin-product-actions button { flex: 1; }
      }
    `}</style>
  );
}
