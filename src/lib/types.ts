export type CardType = 'Legend' | 'Unit' | 'Gear' | 'Program'
export type CardColor = 'Red' | 'Yellow' | 'Blue' | 'Green'

export interface Printing {
  setCode: string
  setName: string
  /** Nombre del set sin sufijo de idioma ("… — FR"). */
  baseSetName: string
  edition: string | null
  collectorNumber: string | null
  language: 'en' | 'fr'
  artist: string | null
  isPrimary: boolean
}

/** Arte alternativo: solo metadatos (no se publican sus imágenes). */
export interface AltArt {
  id: string
  label: string | null
  collectorNumber: string | null
  artist: string | null
  rarity: string | null
  setCode: string | null
  setName: string | null
  baseSetName: string | null
  edition: string | null
}

export interface Card {
  id: string
  name: string
  subname: string | null
  displayName: string
  type: CardType
  color: CardColor | null
  cost: number | null
  power: number | null
  ram: number | null
  rarity: string | null
  setCode: string
  setName: string
  printNumber: string | null
  importId: string | null
  rules: string
  flavor: string | null
  artist: string | null
  classifications: string[]
  keywords: string[]
  legality: string
  isAlpha: boolean
  printings: Printing[]
  altArts: AltArt[]
  image: string
}

export type Quantities = Record<string, number>

export interface Deck {
  id: string
  name: string
  legendIds: string[]
  main: Quantities
  side: Quantities
  updatedAt: string
}

export type Collection = Quantities

export interface ParseIssue {
  line: number
  text: string
  reason: string
}

export interface ParsedDeck {
  name: string
  legendIds: string[]
  main: Quantities
  side: Quantities
  issues: ParseIssue[]
  warnings: string[]
}
