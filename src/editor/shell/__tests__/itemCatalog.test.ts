import { describe, expect, it } from 'vitest'
import { collectItemIds } from '../itemCatalog'

describe('collectItemIds', () => {
  it('derives one sorted catalog from item effects and owned-item conditions', () => {
    expect(collectItemIds(
      {
        reactions: [{
          do: [{
            kind: 'effect',
            effects: [
              { kind: 'item', itemId: 'tea', op: 'give', count: 1 },
              { kind: 'item', itemId: 'lotus-key', op: 'take', count: 1 },
            ],
          }],
        }],
      },
      {
        condition: {
          all: [
            { type: 'hasItem', itemId: 'lotus-key', count: 1 },
            { type: 'hasItem', itemId: 'seal', count: 1 },
          ],
        },
      },
    )).toEqual(['lotus-key', 'seal', 'tea'])
  })
})
