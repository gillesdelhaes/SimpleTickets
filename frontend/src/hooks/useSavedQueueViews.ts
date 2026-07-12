import { useState } from 'react'

export interface SavedQueueView {
  id: string
  name: string
  query: string
}

const STORAGE_KEY = 'st_saved_queue_views'

function load(): SavedQueueView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persist(views: SavedQueueView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views))
}

export function useSavedQueueViews() {
  const [views, setViews] = useState<SavedQueueView[]>(load)

  function saveView(name: string, query: string) {
    const view: SavedQueueView = { id: crypto.randomUUID(), name, query }
    setViews(prev => {
      const next = [...prev, view]
      persist(next)
      return next
    })
  }

  function deleteView(id: string) {
    setViews(prev => {
      const next = prev.filter(v => v.id !== id)
      persist(next)
      return next
    })
  }

  return { views, saveView, deleteView }
}
