// Furniture catalog: default real-world dimensions (metres), ergonomic clearances,
// functional semantics used by the analysis engine, and COCO class mapping for detection.
//
// Local frame convention (shared with the C++ engine):
//   origin = footprint centre on the floor, +z(local) = FRONT of the item, y = up.
//   World pose: (x, z, rot) where rot is a rotation about +Y (three.js convention).

export const CATALOG = {
  bed: {
    label: 'Bed', category: 'Bedroom', icon: 'bed',
    w: 1.52, d: 2.03, h: 0.55, wall: 'back',
    clearance: { front: 0.6, sides: 0.6 },
    access: ['left', 'right'],
    presets: { Twin: [0.99, 1.91], Full: [1.37, 1.91], Queen: [1.52, 2.03], King: [1.93, 2.03] },
    dimLabels: ['Width', 'Length', 'Height'],
  },
  nightstand: {
    label: 'Nightstand', category: 'Bedroom', icon: 'nightstand',
    w: 0.5, d: 0.4, h: 0.6, wall: 'back', clearance: { front: 0.3 }, access: [],
  },
  wardrobe: {
    label: 'Wardrobe', category: 'Bedroom', icon: 'wardrobe',
    w: 1.2, d: 0.6, h: 2.0, wall: 'back', clearance: { front: 0.75 }, access: ['front'], tall: true,
  },
  dresser: {
    label: 'Dresser', category: 'Bedroom', icon: 'dresser',
    w: 1.2, d: 0.5, h: 0.85, wall: 'back', clearance: { front: 0.75 }, access: ['front'],
  },
  desk: {
    label: 'Desk', category: 'Office', icon: 'desk',
    w: 1.2, d: 0.6, h: 0.75, wall: 'back', clearance: { front: 0.9 }, access: ['front'], workplace: true,
  },
  office_chair: {
    label: 'Desk chair', category: 'Office', icon: 'chair',
    w: 0.6, d: 0.6, h: 1.0, wall: null, clearance: {}, access: [], tuckUnder: ['desk'], seat: 1.15,
  },
  bookshelf: {
    label: 'Bookshelf', category: 'Office', icon: 'bookshelf',
    w: 0.9, d: 0.35, h: 1.9, wall: 'back', clearance: { front: 0.6 }, access: ['front'], tall: true,
  },
  sofa: {
    label: 'Sofa', category: 'Living', icon: 'sofa',
    w: 2.1, d: 0.9, h: 0.85, wall: 'back', clearance: { front: 0.45 }, access: ['front'], seat: 1.1,
    presets: { '2-seat': [1.6, 0.9], '3-seat': [2.1, 0.9], '4-seat': [2.6, 0.95] },
  },
  armchair: {
    label: 'Armchair', category: 'Living', icon: 'armchair',
    w: 0.85, d: 0.85, h: 0.9, wall: null, clearance: { front: 0.45 }, access: ['front'], seat: 1.1,
  },
  coffee_table: {
    label: 'Coffee table / teapoy', category: 'Living', icon: 'coffee',
    w: 1.1, d: 0.6, h: 0.42, wall: null, clearance: {}, access: [], low: true,
  },
  tv_stand: {
    label: 'TV + stand', category: 'Living', icon: 'tv',
    w: 1.6, d: 0.45, h: 0.5, wall: 'back', clearance: { front: 0.3 }, access: [], screen: { size: 1.25, h: 0.72 },
  },
  rug: {
    label: 'Rug', category: 'Living', icon: 'rug',
    w: 2.0, d: 1.4, h: 0.01, wall: null, clearance: {}, access: [], collide: false,
  },
  plant: {
    label: 'Plant', category: 'Living', icon: 'plant',
    w: 0.45, d: 0.45, h: 1.1, wall: null, clearance: {}, access: [],
  },
  dining_table: {
    label: 'Dining table', category: 'Dining', icon: 'table',
    w: 1.6, d: 0.9, h: 0.75, wall: null, clearance: { front: 0.9, back: 0.9, sides: 0.9 }, access: [],
  },
  dining_chair: {
    label: 'Dining chair', category: 'Dining', icon: 'chair',
    w: 0.46, d: 0.5, h: 0.9, wall: null, clearance: {}, access: [], tuckUnder: ['dining_table'], seat: 1.15,
  },
  kitchen_counter: {
    label: 'Kitchen counter', category: 'Kitchen', icon: 'counter',
    w: 2.4, d: 0.6, h: 0.9, wall: 'back', clearance: { front: 1.0 }, access: ['front'],
    dimLabels: ['Length', 'Depth', 'Height'],
  },
  fridge: {
    label: 'Refrigerator', category: 'Kitchen', icon: 'fridge',
    w: 0.75, d: 0.7, h: 1.8, wall: 'back', clearance: { front: 1.0 }, access: ['front'], tall: true,
  },
  stove: {
    label: 'Stove / oven', category: 'Kitchen', icon: 'stove',
    w: 0.76, d: 0.65, h: 0.9, wall: 'back', clearance: { front: 1.0 }, access: ['front'],
  },
  toilet: {
    label: 'Toilet', category: 'Bathroom', icon: 'toilet',
    w: 0.4, d: 0.7, h: 0.75, wall: 'back', clearance: { front: 0.6 }, access: ['front'],
  },
};

export const CATEGORIES = ['Bedroom', 'Living', 'Office', 'Dining', 'Kitchen', 'Bathroom'];

let _id = 1;
export function makeItem(type, overrides = {}) {
  const c = CATALOG[type];
  return {
    id: overrides.id ?? `it${Date.now().toString(36)}${(_id++).toString(36)}`,
    type,
    x: 0, z: 0, rot: 0,
    w: c.w, d: c.d, h: c.h,
    locked: false,
    ...overrides,
  };
}

export const spec = (it) => CATALOG[it.type];
export const collides = (it) => CATALOG[it.type].collide !== false;
