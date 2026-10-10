import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

export interface RouteTextureSet {
  asphalt: CanvasTexture;
  checker: CanvasTexture;
  dispose: () => void;
  grass: CanvasTexture;
}

type Rgb = [number, number, number];

interface NoiseTextureOptions {
  baseColor: Rgb;
  grain: number;
  octaves: number[];
  seed: number;
  size: number;
  speckle?: { chance: number; color: Rgb };
  tint?: { color: Rgb; strength: number };
  variation: number;
}

/** Small deterministic PRNG so the procedural textures are identical on every load. */
export function createSeededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothStep(t: number) {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise: a coarse random lattice sampled with bilinear smoothing and wrap-around. */
function createTileableNoise(size: number, cells: number, random: () => number) {
  const lattice = new Float32Array(cells * cells);

  for (let index = 0; index < lattice.length; index += 1) {
    lattice[index] = random();
  }

  const output = new Float32Array(size * size);
  const scale = cells / size;

  for (let y = 0; y < size; y += 1) {
    const fy = y * scale;
    const y0 = Math.floor(fy);
    const ty = smoothStep(fy - y0);
    const y1 = (y0 + 1) % cells;

    for (let x = 0; x < size; x += 1) {
      const fx = x * scale;
      const x0 = Math.floor(fx);
      const tx = smoothStep(fx - x0);
      const x1 = (x0 + 1) % cells;
      const top = lattice[y0 * cells + x0] * (1 - tx) + lattice[y0 * cells + x1] * tx;
      const bottom = lattice[y1 * cells + x0] * (1 - tx) + lattice[y1 * cells + x1] * tx;
      output[y * size + x] = top * (1 - ty) + bottom * ty;
    }
  }

  return output;
}

function createNoiseTexture(options: NoiseTextureOptions) {
  const { baseColor, grain, octaves, seed, size, speckle, tint, variation } = options;
  const random = createSeededRandom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('2D canvas context is not available for procedural textures.');
  }

  const layers = octaves.map((cells) => createTileableNoise(size, cells, random));
  const image = context.createImageData(size, size);
  const data = image.data;

  for (let index = 0; index < size * size; index += 1) {
    let noise = 0;
    let weight = 0;

    for (let layer = 0; layer < layers.length; layer += 1) {
      const layerWeight = 1 / (layer + 1);
      noise += layers[layer][index] * layerWeight;
      weight += layerWeight;
    }

    noise = noise / weight - 0.5;
    const shade = 1 + noise * variation * 2 + (random() - 0.5) * grain * 2;
    let r = baseColor[0] * shade;
    let g = baseColor[1] * shade;
    let b = baseColor[2] * shade;

    if (tint) {
      const tintAmount = Math.max(0, noise) * tint.strength * 2;
      r = r * (1 - tintAmount) + tint.color[0] * tintAmount;
      g = g * (1 - tintAmount) + tint.color[1] * tintAmount;
      b = b * (1 - tintAmount) + tint.color[2] * tintAmount;
    }

    if (speckle && random() < speckle.chance) {
      r = speckle.color[0];
      g = speckle.color[1];
      b = speckle.color[2];
    }

    const offset = index * 4;
    data[offset] = Math.max(0, Math.min(255, r));
    data[offset + 1] = Math.max(0, Math.min(255, g));
    data[offset + 2] = Math.max(0, Math.min(255, b));
    data[offset + 3] = 255;
  }

  context.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createCheckerTexture(size: number, squares: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('2D canvas context is not available for procedural textures.');
  }

  const squareSize = size / squares;

  for (let row = 0; row < squares; row += 1) {
    for (let column = 0; column < squares; column += 1) {
      context.fillStyle = (row + column) % 2 === 0 ? '#f4f4ee' : '#1c1c1e';
      context.fillRect(column * squareSize, row * squareSize, squareSize, squareSize);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createRouteTextures(maxAnisotropy: number, seed: number): RouteTextureSet {
  const asphalt = createNoiseTexture({
    baseColor: [62, 63, 67],
    grain: 0.07,
    octaves: [8, 24, 64, 128],
    seed: seed + 11,
    size: 256,
    speckle: { chance: 0.012, color: [96, 97, 99] },
    variation: 0.1,
  });
  const grass = createNoiseTexture({
    baseColor: [88, 128, 54],
    grain: 0.06,
    octaves: [4, 10, 28, 80],
    seed: seed + 23,
    size: 512,
    tint: { color: [128, 140, 62], strength: 0.3 },
    variation: 0.22,
  });
  const checker = createCheckerTexture(128, 8);

  for (const texture of [asphalt, grass, checker]) {
    texture.anisotropy = Math.max(1, Math.min(maxAnisotropy, 8));
    texture.needsUpdate = true;
  }

  return {
    asphalt,
    checker,
    dispose: () => {
      asphalt.dispose();
      grass.dispose();
      checker.dispose();
    },
    grass,
  };
}
