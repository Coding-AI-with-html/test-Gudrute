// Pakavimo būdai valdomi Supabase lentelėje public.packaging_options.
// PACKAGING_CHOICES paliktas kaip pradinis / suderinamumo sąrašas;
// naujus būdus svetainė pasiima iš duomenų bazės.

export const PACKAGING_CHOICES = [
  "Popierinė dėžutė",
  "Pintas krepšelis",
  "Medinė dėžutė",
  "Medžiaginis maišelis",
  "Skaidri celofaninė / PP plėvelė",
  "Popierius ir kaspinas",
  "Kitas variantas",
] as const;

// Nauji pavadinimai įvedami administravime, todėl tipas turi būti string,
// o ne užfiksuotas vien tik aukščiau išvardintomis reikšmėmis.
export type PackagingChoice = string;

export type PackagingOption = {
  id: number;
  name: string;
  price: number | null;
  is_active?: boolean;
  sort_order?: number;
};
