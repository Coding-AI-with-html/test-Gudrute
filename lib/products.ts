
export const PACKAGING_CHOICES = [
  "Popierinė dėžutė",
  "Pintas krepšelis",
  "Medinė dėžutė",
  "Medžiaginis maišelis",
  "Skaidri celofaninė / PP plėvelė",
  "Popierius ir kaspinas",
  "Kitas variantas",
] as const;

export type PackagingChoice =
  (typeof PACKAGING_CHOICES)[number];
