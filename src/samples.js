// Demo projects (deliberately imperfect, so the analysis has something to show).
import { makeItem } from './core/catalog.js';

const P = Math.PI;
export const SAMPLES = {
  bedroom: () => ({
    roomType: 'Bedroom',
    room: { width: 4.2, length: 3.8, height: 2.7, doors: [{ wall: 'S', offset: 0.3, width: 0.85 }], windows: [{ wall: 'N', offset: 1.5, width: 1.4, sill: 0.9, height: 1.3 }] },
    items: [
      makeItem('bed', { x: 2.3, z: 2.6, rot: P }),
      makeItem('nightstand', { x: 0.6, z: 3.55, rot: P }),
      makeItem('wardrobe', { x: 0.35, z: 1.2, rot: P / 2 }),
      makeItem('desk', { x: 3.6, z: 0.9, rot: -P / 2 }),
      makeItem('office_chair', { x: 2.9, z: 1.4, rot: P / 2 }),
      makeItem('bookshelf', { x: 1.0, z: 0.6, rot: 0.3 }),
      makeItem('plant', { x: 3.9, z: 3.5 }),
    ],
  }),
  living: () => ({
    roomType: 'Living room',
    room: { width: 5.4, length: 4.2, height: 2.8, doors: [{ wall: 'W', offset: 0.4, width: 0.9 }], windows: [{ wall: 'N', offset: 1.2, width: 2.0, sill: 0.6, height: 1.6 }, { wall: 'E', offset: 1.5, width: 1.2, sill: 0.9, height: 1.3 }] },
    items: [
      makeItem('sofa', { x: 2.7, z: 0.5, rot: 0 }),
      makeItem('coffee_table', { x: 2.5, z: 2.1 }),
      makeItem('tv_stand', { x: 4.4, z: 3.9, rot: P }),
      makeItem('armchair', { x: 0.9, z: 2.5, rot: P / 2 }),
      makeItem('rug', { x: 2.7, z: 1.9 }),
      makeItem('bookshelf', { x: 0.2, z: 1.2, rot: P / 2 }),
      makeItem('plant', { x: 5.0, z: 0.4 }),
      makeItem('dining_table', { x: 4.4, z: 1.9, rot: P / 2 }),
    ],
  }),
  studio: () => ({
    roomType: 'Studio flat',
    room: { width: 6.0, length: 4.5, height: 2.7, doors: [{ wall: 'S', offset: 4.6, width: 0.9 }], windows: [{ wall: 'N', offset: 0.8, width: 1.6, sill: 0.8, height: 1.4 }, { wall: 'N', offset: 3.6, width: 1.6, sill: 0.8, height: 1.4 }] },
    items: [
      makeItem('bed', { w: 1.37, d: 1.91, x: 1.0, z: 3.4, rot: P / 2 }),
      makeItem('nightstand', { x: 0.3, z: 2.2 }),
      makeItem('kitchen_counter', { x: 4.8, z: 0.3 }),
      makeItem('fridge', { x: 3.2, z: 0.35 }),
      makeItem('sofa', { w: 1.6, x: 3.6, z: 2.6, rot: P }),
      makeItem('tv_stand', { w: 1.2, x: 3.5, z: 1.2 }),
      makeItem('dining_table', { w: 1.0, d: 0.8, x: 5.2, z: 2.6 }),
      makeItem('dining_chair', { x: 5.2, z: 2.0, rot: 0 }),
      makeItem('dining_chair', { x: 5.2, z: 3.2, rot: P }),
      makeItem('desk', { x: 2.3, z: 4.2, rot: P }),
      makeItem('office_chair', { x: 2.3, z: 3.6 }),
      makeItem('wardrobe', { x: 0.3, z: 0.9, rot: P / 2 }),
    ],
  }),
};
