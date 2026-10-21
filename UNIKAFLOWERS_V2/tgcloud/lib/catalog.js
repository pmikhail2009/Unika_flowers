import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { products } from '../schema.js';
import { INITIAL_PRODUCTS } from './catalog-seed.js';
export { parseHeight } from './validation.js';

export async function ensureCatalog() {
  for (const item of INITIAL_PRODUCTS) {
    await db.insert(products).values({
      id: item.id,
      name: item.name,
      shortDescription: item.shortDescription,
      description: item.description,
      heightMin: item.heightCm[0],
      heightMax: item.heightCm[1],
      bloomMin: item.bloomCm[0],
      bloomMax: item.bloomCm[1],
      image: item.image,
    }).onConflictDoNothing({ target: products.id }).run();
  }
}

export function toPublicProduct(item) {
  return {
    id: item.id,
    name: item.name,
    shortDescription: item.shortDescription,
    description: item.description,
    heightCm: [item.heightMin, item.heightMax],
    bloomCm: [item.bloomMin, item.bloomMax],
    image: item.photoData || item.image,
    price: item.price,
    availability: item.availability,
    version: item.version,
  };
}

export function imageDataUrl(bytes) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    result += abc[a >> 2] + abc[((a & 3) << 4) | ((b ?? 0) >> 4)];
    result += b === undefined ? '=' : abc[((b & 15) << 2) | ((c ?? 0) >> 6)];
    result += c === undefined ? '=' : abc[c & 63];
  }
  return `data:image/jpeg;base64,${result}`;
}

export async function photoData(fileId) {
  const bytes = await api.getFileContent(fileId);
  if (bytes.length > 750_000) throw new Error('PHOTO_TOO_LARGE');
  return imageDataUrl(bytes);
}

export async function productById(id) {
  await ensureCatalog();
  return db.select().from(products).where(eq(products.id, id)).get();
}
