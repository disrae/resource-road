// Photo-scanned ground materials (Poly Haven, CC0: see CREDITS.md). Each graphics level asks for
// its own sizes, so the light level only ever downloads the small colour images.
//
// Files, in public/assets/ground/ (made by tools/convert-textures.py):
//   <id>_a_<size>.webp   colour
//   <id>_n_<size>.webp   one grey image three squares wide: normal x | normal y | roughness
//
// The five materials go into two array textures, one layer each, in the order of GROUND_LAYERS
// (the ground shader in materials.js picks layers by number).
import * as THREE from '../../vendor/three.module.min.js';

export const GROUND_LAYERS = ['rocky_trail', 'brown_mud_03', 'rubble', 'brown_mud_rocks_01', 'forrest_ground_01'];
const BASE = new URL('../../assets/ground/', import.meta.url);

function arrayTexture(data, size, layers, srgb, aniso) {
  const t = new THREE.DataArrayTexture(data, size, size, layers);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// sizes = { albedo: 512 | 1024 | 2048, normal: 0 | 512 | 1024 | 2048 }. onProgress(done, total) is
// called as files arrive. Resolves to { albedo, nr, mode, bytes, files } where mode is 1 (colour
// only) or 2 (colour, normals and roughness), or to null when the images could not be loaded: the
// game then draws its built-in generated ground instead.
export async function loadGroundTextures(sizes, onProgress = () => {}, aniso = 4) {
  if (!sizes || !sizes.albedo || typeof createImageBitmap !== 'function') return null;
  const n = GROUND_LAYERS.length, jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push({ layer: i, kind: 'a', size: sizes.albedo });
    if (sizes.normal) jobs.push({ layer: i, kind: 'n', size: sizes.normal });
  }
  let done = 0, bytes = 0; onProgress(0, jobs.length);
  const albedo = new Uint8Array(sizes.albedo * sizes.albedo * 4 * n);
  const nr = sizes.normal ? new Uint8Array(sizes.normal * sizes.normal * 4 * n) : null;
  // downloads run side by side; the unpacking is done one image at a time to keep memory down
  let chain = Promise.resolve();
  try {
    await Promise.all(jobs.map((j) => {
      const got = fetch(new URL(`${GROUND_LAYERS[j.layer]}_${j.kind}_${j.size}.webp`, BASE)).then((res) => { if (!res.ok) throw new Error(`${res.status} for ${res.url}`); return res.blob(); });
      return got.then((blob) => (chain = chain.then(async () => {
        const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
        const S = j.size, px = g.getImageData(0, 0, cv.width, cv.height).data;
        if (j.kind === 'a') {
          if (cv.width !== S || cv.height !== S) throw new Error('unexpected image size');
          albedo.set(px, j.layer * S * S * 4);
        } else {
          if (cv.width !== S * 3 || cv.height !== S) throw new Error('unexpected image size');
          const o = j.layer * S * S * 4, W = S * 3;
          for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const q = o + (y * S + x) * 4, p = (y * W + x) * 4;
            nr[q] = px[p]; nr[q + 1] = px[p + S * 4]; nr[q + 2] = px[p + S * 8]; nr[q + 3] = 255;
          }
        }
        cv.width = cv.height = 1;
        bytes += blob.size; onProgress(++done, jobs.length);
      })));
    }));
  } catch (e) {
    console.warn('ground textures not loaded, using the generated ground', e);
    return null;
  }
  return {
    albedo: arrayTexture(albedo, sizes.albedo, n, true, aniso),
    nr: nr ? arrayTexture(nr, sizes.normal, n, false, aniso) : null,
    mode: nr ? 2 : 1, bytes, files: jobs.length, sizes,
  };
}
