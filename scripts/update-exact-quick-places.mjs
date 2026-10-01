import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("Supabase não configurado.");

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const points = [
  {
    aliases: ["rodoviária", "terminal rodoviário"],
    name: "Terminal Rodoviário",
    address: "BR-110, 33, Centro, Ribeira do Pombal - BA, 48400-000",
    latitude: -10.8420095,
    longitude: -38.5320477,
    category: "bus_station",
    icon: "bus",
    color: "#0964ed",
    active: true,
    featured: true,
    sort_order: 10,
  },
  {
    aliases: ["hospital municipal"],
    name: "Hospital Municipal",
    address: "Hospital Geral Santa Tereza, Rua Salustiano Guerra, 338, Centro, Ribeira do Pombal - BA, 48400-000",
    latitude: -10.8372948,
    longitude: -38.5390976,
    category: "hospital",
    icon: "hospital",
    color: "#ed1828",
    active: true,
    featured: true,
    sort_order: 20,
  },
  {
    aliases: ["prefeitura", "prefeitura municipal"],
    name: "Prefeitura Municipal",
    address: "Praça José Domingos, s/n, Centro, Ribeira do Pombal - BA, 48400-000",
    latitude: -10.8454263,
    longitude: -38.5418563,
    category: "government",
    icon: "government",
    color: "#eaa400",
    active: true,
    featured: true,
    sort_order: 30,
  },
  {
    aliases: ["praça getúlio vargas", "praca getulio vargas", "praça da juventude"],
    name: "Praça da Juventude",
    address: "Rua Princesa Isabel, Ribeira do Pombal - BA, 48400-000",
    latitude: -10.8385419,
    longitude: -38.5435725,
    category: "square",
    icon: "square",
    color: "#0c963d",
    active: true,
    featured: true,
    sort_order: 40,
  },
  {
    aliases: ["centro educacional", "c.e.a.s.", "ceas"],
    name: "C.E.A.S.",
    address: "Centro Educacional Alegria de Saber, Rua Benedito Borges, 140, Centro, Ribeira do Pombal - BA, 48400-000",
    latitude: -10.8344852,
    longitude: -38.5354938,
    category: "education",
    icon: "education",
    color: "#8034e8",
    active: true,
    featured: true,
    sort_order: 50,
  },
  {
    aliases: ["mercado municipal", "baraúna", "barauna", "brauna atacadista"],
    name: "Baraúna",
    address: "Brauna Atacadista, Avenida Evência Brito, Ribeira do Pombal - BA, 48400-000",
    latitude: -10.8398388,
    longitude: -38.533576,
    category: "market",
    icon: "market",
    color: "#f5a300",
    active: true,
    featured: false,
    sort_order: 70,
  },
  {
    aliases: ["aroldo barber", "barbearia aroldo barber"],
    name: "Aroldo Barber",
    address: "Rua Salustiano Guerra, 87, Centro, Ribeira do Pombal - BA, 48400-000",
    latitude: -10.8370013,
    longitude: -38.5422602,
    category: "store",
    icon: "store",
    color: "#111827",
    active: true,
    featured: false,
    sort_order: 80,
  },
  {
    aliases: ["crg", "crg elétrica distribuidora"],
    name: "CRG",
    address: "CRG Elétrica Distribuidora, Avenida Oliveira Brito, 257 A, Loja 101, Centro, Ribeira do Pombal - BA, 48400-000",
    latitude: -10.8363864,
    longitude: -38.5403909,
    category: "store",
    icon: "store",
    color: "#0b3f69",
    active: true,
    featured: false,
    sort_order: 90,
  },
];

const normalize = (value) => value.trim().toLocaleLowerCase("pt-BR");
const { data: current, error: readError } = await supabase
  .from("quick_places")
  .select("id,name");
if (readError) throw readError;

for (const point of points) {
  const { aliases, ...values } = point;
  const existing = current.find((item) => aliases.includes(normalize(item.name)));
  const query = existing
    ? supabase.from("quick_places").update(values).eq("id", existing.id)
    : supabase.from("quick_places").insert(values);
  const { error } = await query;
  if (error) throw new Error(`${point.name}: ${error.message}`);
}

const names = points.map((point) => point.name);
const { data: verified, error: verifyError } = await supabase
  .from("quick_places")
  .select("name,address,latitude,longitude,active,featured,sort_order")
  .in("name", names)
  .order("sort_order", { ascending: true });
if (verifyError) throw verifyError;
if (verified.length !== points.length) {
  throw new Error(`Esperados ${points.length} pontos; encontrados ${verified.length}.`);
}

console.table(verified.map(({ name, latitude, longitude, active }) => ({
  name, latitude, longitude, active,
})));
