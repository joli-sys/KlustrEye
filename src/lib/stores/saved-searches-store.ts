import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SavedSearch {
  id: string;
  name: string;
  kind: string;
  query: string;
  namespace?: string;
}

interface SavedSearchesState {
  searches: SavedSearch[];
  addSearch: (search: SavedSearch) => void;
  removeSearch: (id: string) => void;
}

export const useSavedSearches = create<SavedSearchesState>()(
  persist(
    (set) => ({
      searches: [],
      addSearch: (search) =>
        set((state) => ({ searches: [...state.searches, search] })),
      removeSearch: (id) =>
        set((state) => ({
          searches: state.searches.filter((s) => s.id !== id),
        })),
    }),
    { name: "klustreye-saved-searches" }
  )
);
