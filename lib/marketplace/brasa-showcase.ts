import type { MarketCatalog } from "./customer-contract";
import data from "./brasa-showcase-data.json";

export const BRASA_SHOWCASE_PATH = "/compras/demonstracao/brasa-da-vila";

const slug = "brasa-da-vila";
const prefix = `${slug}:demonstracao`;
const asset = (filename: string) => `/marketplace-demo/${slug}/${filename}`;
const categoryId = (id: string) => `${prefix}:categoria:${id}`;

// The supplied ZIP is a standalone demo. This curated projection contains
// only its illustrative catalog, with IDs outside the live Supabase schema.
export const BRASA_SHOWCASE_CATALOG: MarketCatalog = {
  checkoutAvailable: false,
  store: {
    id: prefix,
    slug,
    name: "Brasa da Vila — Demonstração",
    description: "Cardápio ilustrativo de lanches e burgers para conhecer o modelo das lojas de Compras.",
    category: "Lanches · Burgers · Salgados",
    image_url: asset("logo.webp"),
    cover_url: asset("cover.webp"),
    address: "",
    hours: {},
    prep_minutes: null,
    service_area_id: null,
    open: false,
  },
  categories: data.categories.map(({ id, name }) => ({ id: categoryId(id), name })),
  products: data.products.map((product) => {
    const productId = `${prefix}:produto:${product.id}`;
    return {
      id: productId,
      category_id: categoryId(product.category),
      name: product.name,
      description: product.description,
      image_url: asset(product.image),
      price_cents: product.price,
      available: product.available,
      groups: product.options.map((group) => {
        const groupId = `${productId}:grupo:${group.id}`;
        return {
          id: groupId,
          name: group.name,
          min_select: group.min,
          max_select: group.max,
          options: group.choices.map((option) => ({
            id: `${groupId}:opcao:${option.id}`,
            name: option.name,
            price_cents: option.price,
          })),
        };
      }),
    };
  }),
};
