
"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";

type PackagingOption = {
  id: number;
  name: string;
  price: number | null;
  is_active: boolean;
  sort_order: number;
};

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
  packaging_choices: string[];
  packaging_option_ids: number[];
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
  packaging_option_ids: number[];
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
  packaging_option_ids: [],
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
  const [packagingOptions, setPackagingOptions] = useState<PackagingOption[]>([]);
  const [packagingOptionName, setPackagingOptionName] = useState("");
  const [packagingOptionPrice, setPackagingOptionPrice] = useState("");
  const [editingPackagingOptionId, setEditingPackagingOptionId] = useState<number | null>(null);
  const [form, setForm] = useState<EditorForm>(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadPackagingOptions = useCallback(async () => {
    const { data, error } = await supabase
      .from("packaging_options")
      .select("id, name, price, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      setError("Nepavyko įkelti pakavimo būdų: " + error.message);
      return;
    }

    setPackagingOptions((data ?? []) as PackagingOption[]);
  }, [supabase]);

  const loadProducts = useCallback(async () => {
    const [{ data, error }, { data: links, error: linksError }] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("product_packaging_options")
        .select("product_id, packaging_option_id"),
    ]);

    if (error) {
      setError("Nepavyko įkelti produktų: " + error.message);
      return;
    }
    if (linksError) {
      setError("Nepavyko įkelti produktų pakavimo būdų: " + linksError.message);
      return;
    }

    const idsByProduct = new Map<number, number[]>();
    (links ?? []).forEach((link: { product_id: number; packaging_option_id: number }) => {
      const current = idsByProduct.get(Number(link.product_id)) ?? [];
      current.push(Number(link.packaging_option_id));
      idsByProduct.set(Number(link.product_id), current);
    });

    setProducts(
      (data ?? []).map((row: any) => ({
        ...row,
        packaging_choices: row.packaging_choices ?? [],
        packaging_option_ids: idsByProduct.get(Number(row.id)) ?? [],
      })) as Product[]
    );
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
        await Promise.all([loadProducts(), loadPackagingOptions()]);
      } else if (data.session) {
        await supabase.auth.signOut();
      }

      if (alive) setChecking(false);
    }

    void checkSession();

    return () => {
      alive = false;
    };
  }, [supabase, adminUid, loadProducts, loadPackagingOptions]);

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
      await Promise.all([loadProducts(), loadPackagingOptions()]);
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
    setPackagingOptions([]);
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
      packaging_option_ids: product.packaging_option_ids ?? [],
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
      const uniqueId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

      const path = `${uniqueId}.${extension}`;

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
    const selectedOptions = packagingOptions.filter(
      (option) => form.packaging_option_ids.includes(option.id) && option.is_active
    );

    if (form.category === "Pakavimo paslaugos" && selectedOptions.length === 0) {
      setError("Pasirink bent vieną aktyvų pakavimo būdą.");
      return;
    }

    setLoading(true);

    let uploadedPaths: string[] = [];
    let productSaved = false;

    try {
      const uploaded = await uploadImages(files);
      uploadedPaths = uploaded.paths;

      const imageUrls = [...form.image_urls, ...uploaded.urls];

      const selectedOptionIds =
        form.category === "Pakavimo paslaugos"
          ? selectedOptions.map((option) => option.id)
          : [];
      const selectedChoices = selectedOptions.map((option) => option.name);

      const payload = {
        name: form.name.trim(),
        category: form.category,
        price,
        description: form.description.trim(),
        label: form.label.trim(),
        image_urls: imageUrls,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,

        // Senas stulpelis paliekamas suderinamumui su ankstesniu svetainės kodu.
        packaging_choices: selectedChoices,

        packaging_mode:
          form.category === "Dovanų rinkiniai"
            ? "none"
            : selectedChoices.length === 1 && selectedChoices[0] === "Popierinė dėžutė"
              ? "fixed_paper_box"
              : selectedChoices.length === 1 && selectedChoices[0] === "Pintas krepšelis"
                ? "fixed_basket"
                : "custom",

        updated_at: new Date().toISOString(),
      };

      let productId = editingId;

      if (editingId !== null) {
        const result = await supabase
          .from("products")
          .update(payload)
          .eq("id", editingId);

        if (result.error) throw result.error;
        productSaved = true;
      } else {
        const result = await supabase
          .from("products")
          .insert(payload)
          .select("id")
          .single();

        if (result.error) throw result.error;
        productId = Number(result.data.id);
        productSaved = true;
      }

      if (productId === null) {
        throw new Error("Nepavyko nustatyti produkto ID.");
      }

      const { error: deleteLinksError } = await supabase
        .from("product_packaging_options")
        .delete()
        .eq("product_id", productId);

      if (deleteLinksError) throw deleteLinksError;

      if (selectedOptionIds.length) {
        const { error: insertLinksError } = await supabase
          .from("product_packaging_options")
          .insert(
            selectedOptionIds.map((packagingOptionId) => ({
              product_id: productId,
              packaging_option_id: packagingOptionId,
            }))
          );

        if (insertLinksError) throw insertLinksError;
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
      await Promise.all([loadProducts(), loadPackagingOptions()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nepavyko išsaugoti produkto.");

      if (uploadedPaths.length && !productSaved) {
        await supabase.storage.from("product-images").remove(uploadedPaths);
      }
    } finally {
      setLoading(false);
    }
  }

  function startEditPackagingOption(option: PackagingOption) {
    setEditingPackagingOptionId(option.id);
    setPackagingOptionName(option.name);
    setPackagingOptionPrice(option.price === null ? "" : String(option.price));
    setError("");
    setMessage("");
  }

  function resetPackagingOptionForm() {
    setEditingPackagingOptionId(null);
    setPackagingOptionName("");
    setPackagingOptionPrice("");
  }

  async function handlePackagingOptionSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const name = packagingOptionName.trim();
    const rawPrice = packagingOptionPrice.trim().replace(",", ".");
    const price = Number(rawPrice);

    if (!name) {
      setError("Įrašyk pakavimo būdo pavadinimą.");
      return;
    }
    if (rawPrice === "" || !Number.isFinite(price) || price < 0) {
      setError("Įrašyk teisingą pakavimo būdo kainą.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name,
        price,
        updated_at: new Date().toISOString(),
      };

      const result = editingPackagingOptionId === null
        ? await supabase.from("packaging_options").insert({ ...payload, is_active: true })
        : await supabase.from("packaging_options").update(payload).eq("id", editingPackagingOptionId);

      if (result.error) throw result.error;

      resetPackagingOptionForm();
      setMessage(editingPackagingOptionId === null
        ? "Pakavimo būdas pridėtas."
        : "Pakavimo būdas atnaujintas.");
      await loadPackagingOptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nepavyko išsaugoti pakavimo būdo.");
    } finally {
      setLoading(false);
    }
  }

  async function togglePackagingOption(option: PackagingOption) {
    setError("");
    setMessage("");
    const { error } = await supabase
      .from("packaging_options")
      .update({ is_active: !option.is_active, updated_at: new Date().toISOString() })
      .eq("id", option.id);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(option.is_active
      ? "Pakavimo būdas išjungtas. Esami produktų priskyrimai išsaugoti."
      : "Pakavimo būdas vėl aktyvus.");
    await loadPackagingOptions();
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
          <h2>Pakavimo būdų katalogas</h2>
          <p>
            Čia gali pridėti naujų pakavimo būdų ir nustatyti kiekvieno kainą.
            Kaina naudojama kaip galutinė pasirinkto pakavimo paslaugos kaina,
            o ne kaip papildomas mokestis prie produkto kainos.
          </p>

          <form onSubmit={handlePackagingOptionSave} className="admin-form admin-packaging-manager-form">
            <label>
              Pakavimo būdo pavadinimas
              <input
                value={packagingOptionName}
                onChange={(e) => setPackagingOptionName(e.target.value)}
                placeholder="Pvz., Medinė dėžutė"
                required
              />
            </label>
            <label>
              Kaina (€)
              <input
                type="number"
                min="0"
                step="0.01"
                value={packagingOptionPrice}
                onChange={(e) => setPackagingOptionPrice(e.target.value)}
                placeholder="Pvz., 8.50"
                required
              />
            </label>
            <div className="admin-form-actions">
              <button disabled={loading}>
                {loading ? "Saugoma..." : editingPackagingOptionId === null ? "Pridėti pakavimo būdą" : "Išsaugoti pakavimo būdą"}
              </button>
              {editingPackagingOptionId !== null && (
                <button type="button" className="secondary" onClick={resetPackagingOptionForm}>
                  Atšaukti
                </button>
              )}
            </div>
          </form>

          <div className="admin-packaging-catalog">
            {packagingOptions.length === 0 ? (
              <p>Pakavimo būdų dar nėra. Sukurk pirmąjį būdą aukščiau.</p>
            ) : packagingOptions.map((option) => (
              <div className="admin-packaging-option" key={option.id}>
                <div>
                  <strong>{option.name}</strong>
                  <span>{option.price === null ? "Kaina nenustatyta" : money(option.price)}</span>
                  <span className={option.is_active ? "status active" : "status hidden"}>
                    {option.is_active ? "Aktyvus" : "Išjungtas"}
                  </span>
                </div>
                <div className="admin-product-actions">
                  <button type="button" className="secondary" onClick={() => startEditPackagingOption(option)}>
                    Keisti
                  </button>
                  <button type="button" className="secondary" onClick={() => togglePackagingOption(option)}>
                    {option.is_active ? "Išjungti" : "Aktyvinti"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

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

                  setForm((current) => ({
                    ...current,
                    category,
                    packaging_mode:
                      category === "Pakavimo paslaugos" ? "custom" : "none",
                    packaging_option_ids:
                      category === "Pakavimo paslaugos"
                        ? current.packaging_option_ids.length
                          ? current.packaging_option_ids
                          : packagingOptions.filter((option) => option.is_active).slice(0, 1).map((option) => option.id)
                        : [],
                  }));
                }}
                                >
                  <option>Pakavimo paslaugos</option>
                  <option>Dovanų rinkiniai</option>
                </select>
              </label>

              <label>
                {form.category === "Pakavimo paslaugos"
                  ? "Atsarginė kaina (€), jei pakavimo būdo kaina nenustatyta"
                  : "Kaina (€)"}
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
            <div className="admin-packaging-options">
              <strong>Pakavimo pasirinkimas</strong>

              <p>
                Pažymėk visus įpakavimo būdus, kuriuos klientas
                galės pasirinkti šiai paslaugai.
              </p>

              {packagingOptions.map((option) => {
                const isSelected = form.packaging_option_ids.includes(option.id);
                return (
                  <label className="admin-checkbox" key={option.id}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!option.is_active && !isSelected}
                      onChange={(e) => {
                        setForm((current) => ({
                          ...current,
                          packaging_option_ids: e.target.checked
                            ? [...current.packaging_option_ids, option.id]
                            : current.packaging_option_ids.filter((id) => id !== option.id),
                        }));
                      }}
                    />
                    <span>
                      {option.name} — {option.price === null ? "kaina nenustatyta" : money(option.price)}
                      {!option.is_active ? " (išjungtas – klientams nerodomas)" : ""}
                    </span>
                  </label>
                );
              })}
              {packagingOptions.length === 0 && (
                <p>Pirmiausia sukurk bent vieną pakavimo būdą žemiau esančiame kataloge.</p>
              )}
            </div>
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
              onChange={(e) => {
                const selectedFiles = Array.from(e.currentTarget.files ?? []);

                setFiles((current) => {
                  const known = new Set(
                    current.map(
                      (file) => `${file.name}-${file.size}-${file.lastModified}`
                    )
                  );

                  const additions = selectedFiles.filter((file) => {
                    const key = `${file.name}-${file.size}-${file.lastModified}`;

                    if (known.has(key)) return false;

                    known.add(key);
                    return true;
                  });

                  return [...current, ...additions];
                });

                // Leidžia vėl pasirinkti tą patį failą.
                e.currentTarget.value = "";
              }}
            />

            </label>

            
            {files.length > 0 && (
              <div className="admin-new-files">
                <strong>
                  Pasirinkta naujų nuotraukų: {files.length}
                </strong>

                {files.map((file, index) => (
                  <div
                    className="admin-new-file"
                    key={`${file.name}-${file.lastModified}-${index}`}
                  >
                    <span>
                      {file.name} (
                      {(file.size / 1024 / 1024).toFixed(2)} MB)
                    </span>

                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, i) => i !== index)
                        )
                      }
                    >
                      Pašalinti
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="secondary"
                  onClick={() => setFiles([])}
                >
                  Pašalinti visas naujas nuotraukas
                </button>
              </div>
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
                    {product.packaging_option_ids.length > 0 && (
                      <span className="admin-help">
                        Pakavimas: {product.packaging_option_ids
                          .map((id) => packagingOptions.find((option) => option.id === id)?.name)
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    )}
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
      .admin-packaging-options {
        display: grid;
        gap: 12px;
        padding: 16px;
        border: 1px solid #e5e0d7;
        border-radius: 10px;
        background: #f7f5f1;
      }

      .admin-packaging-options p {
        margin: 0;
        color: #81796d;
        font-size: 13px;
        line-height: 1.5;
      }
      .admin-packaging-manager-form {
        grid-template-columns: 1.4fr 1fr auto;
        align-items: end;
        margin: 18px 0;
      }
      .admin-packaging-catalog { display: grid; gap: 9px; margin-top: 18px; }
      .admin-packaging-option {
        display: flex; align-items: center; justify-content: space-between;
        gap: 14px; padding: 13px; border: 1px solid #eeeae3; border-radius: 10px;
      }
      .admin-packaging-option > div:first-child { display: grid; gap: 4px; }
      .admin-packaging-option > div:first-child > span { font-size: 13px; color: #81796d; }
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
      .admin-new-files {display: grid;gap: 10px;padding: 14px;background: #f7f5f1;border-radius: 10px;}
      .admin-new-file {display: flex;align-items: center;justify-content: space-between;gap: 12px;padding: 8px 0;border-bottom: 1px solid #e5e0d7;font-size: 13px;overflow-wrap: anywhere;}
      .admin-new-file button {flex-shrink: 0;}
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
        .admin-packaging-manager-form { grid-template-columns: 1fr; }
        .admin-packaging-option { align-items: flex-start; flex-direction: column; }
        .admin-product { grid-template-columns: 75px 1fr; }
        .admin-product > img, .admin-no-image { width: 75px; height: 75px; }
        .admin-product-actions { grid-column: 1 / -1; }
        .admin-product-actions button { flex: 1; }
      }
    `}</style>
  );
}
