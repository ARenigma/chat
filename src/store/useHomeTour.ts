import { create } from 'zustand';
import { storage } from '../lib/storage';

const HOME_TOUR_KEY = 'companion.homeTour.v1';

export type TourTargetId = 'wallet' | 'chats' | 'explore' | 'favourites' | 'home';

interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TOUR_STEPS: readonly {
  id: TourTargetId;
  title: string;
  body: string;
}[] = [
  {
    id: 'wallet',
    title: 'Talk-time',
    body: 'Your balance lives here. Tap it any time to add more.',
  },
  {
    id: 'chats',
    title: 'Chats',
    body: 'People you have already talked to. Long-press a face to pin, hide, or delete.',
  },
  {
    id: 'explore',
    title: 'Explore',
    body: 'Everyone you can start with. Tap a person to open their profile.',
  },
  {
    id: 'favourites',
    title: 'Favourites',
    body: 'Hearts you save land on this tab.',
  },
  {
    id: 'home',
    title: 'Home',
    body: 'This tab is the list. You are here whenever you want people and chats.',
  },
];

interface HomeTourState {
  seen: boolean;
  active: boolean;
  step: number;
  targets: Partial<Record<TourTargetId, TourRect>>;
  register: (id: TourTargetId, rect: TourRect) => void;
  start: () => void;
  next: () => void;
  skip: () => void;
}

function markSeen(): void {
  storage.set(HOME_TOUR_KEY, '1');
}

export const useHomeTour = create<HomeTourState>((set, get) => ({
  seen: storage.get(HOME_TOUR_KEY) === '1',
  active: false,
  step: 0,
  targets: {},
  register: (id, rect) => {
    const prev = get().targets[id];
    if (
      prev &&
      prev.x === rect.x &&
      prev.y === rect.y &&
      prev.width === rect.width &&
      prev.height === rect.height
    ) {
      return;
    }
    set({ targets: { ...get().targets, [id]: rect } });
  },
  start: () => {
    if (get().seen || get().active) {
      return;
    }
    set({ active: true, step: 0 });
  },
  next: () => {
    const step = get().step;
    if (step >= TOUR_STEPS.length - 1) {
      markSeen();
      set({ active: false, seen: true, step: 0 });
      return;
    }
    set({ step: step + 1 });
  },
  skip: () => {
    markSeen();
    set({ active: false, seen: true, step: 0 });
  },
}));
