# Codex project memory

## Card deck instances

- Do not split one face card into different ids just because it appears in several decks.
- A deck is a stack of card instances. Each instance must preserve:
  - `cardId`: rules identity, for example `bark`.
  - `sourceDeck`: concrete deck the instance was drawn from, for example `forest_trail`.
  - `sourceBack`: concrete back shown for that instance, normally the same as `sourceDeck`.
  - `artId` when the JSON inventory provides a separate art reference.
- Rules must look at the card identity/properties, not at the back image.
- Returning a card to "its deck" must use `sourceDeck`.
- Drawing `bark` from `forest_trail` must keep `cardId: "bark"` and set `sourceBack: "forest_trail"`, not `"forest"`.
- Drawing the same `art_dark_forest_001` face from `forest` must keep `cardId: "art_dark_forest_001"` and set `sourceBack: "forest"`.

## 2026-07-01 sourceBack fix

- Build version: `20260701-16`.
- Changed `server-prototype/src/rules.js`: `drawnCardSource(cardId, sourceDeck)` now stores `sourceBack = sourceDeck`.
- Changed `server-prototype/scripts/test-rules.js`: tests now require `forest_trail` draw instances to keep `sourceBack: "forest_trail"` through draw, transfer, terrain place, and terrain remove.
- Verified with `node --test server-prototype/scripts/test-rules.js server-prototype/scripts/test-cell-draw-decks.js server-prototype/scripts/test-catalog.js`.
- Did not change shuffle/deck order logic. Do not edit `shuffle`, `spreadAdjacentShuffleGroups`, `buildDeck`, or the JSON deck counts when fixing source backs.

## 2026-07-01 beast card board placement

- Build versions: `20260701-11` through `20260701-15`.
- Changed only visual placement of beast-combat cards on the board.
- Beast card placement must avoid character figures and current selected character move cells, but stay visually beside the figure.
- Current board beast-card bounds are intentionally smaller than visual art bounds to avoid overreacting to empty transparent margins.

