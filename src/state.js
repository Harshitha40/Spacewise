// Central app state + tiny event bus + undo/redo history for the layout.
const listeners = {};
export const bus = {
  on(ev, fn) { (listeners[ev] ||= []).push(fn); },
  emit(ev, ...a) { (listeners[ev] || []).forEach((f) => f(...a)); },
};

export const state = {
  step: 'upload',
  units: 'imperial',
  photo: null,          // { url, el (HTMLImageElement), w, h, name }
  detections: [],
  roomType: 'Room',
  room: defaultRoom(),
  items: [],
  calib: null,          // { img: [[u,v]x4], plan: [[x,z]x4], depth, mode }
  calibration: null,    // result of calibrate()
  selected: null,
  report: null,
  suggestions: null,
  preview: null,        // index of suggestion being previewed
  view: 'orbit',
  toggles: { collisions: true, walkability: true, paths: true, daylight: false, sightlines: true, clearance: false },
  hour: 15, north: 'N',
};

export function defaultRoom() {
  return {
    width: 4.2, length: 3.8, height: 2.7,
    doors: [{ wall: 'S', offset: 0.35, width: 0.85 }],
    windows: [{ wall: 'N', offset: 1.4, width: 1.4, sill: 0.9, height: 1.3 }],
  };
}

const past = [], future = [];
const snap = () => JSON.stringify(state.items);
export const history = {
  push() { past.push(snap()); if (past.length > 100) past.shift(); future.length = 0; },
  undo() { if (!past.length) return false; future.push(snap()); state.items = JSON.parse(past.pop()); return true; },
  redo() { if (!future.length) return false; past.push(snap()); state.items = JSON.parse(future.pop()); return true; },
  clear() { past.length = 0; future.length = 0; },
  get canUndo() { return past.length > 0; },
  get canRedo() { return future.length > 0; },
};

export function serialize() {
  return JSON.stringify({
    format: 'layoutlens/1', units: state.units, roomType: state.roomType, room: state.room, items: state.items,
    calib: state.calib, photo: state.photo ? { url: state.photo.url, w: state.photo.w, h: state.photo.h } : null,
    detections: state.detections.map(({ thumb, ...d }) => d),
  });
}
