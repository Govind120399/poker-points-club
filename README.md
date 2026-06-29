# Poker Points Club

A Firebase-backed multiplayer Texas Hold'em points table.

## What Changed

- Players sign in from separate devices.
- Table state is shared through Firestore.
- Hole cards are stored in a per-user private hand document instead of the public game state.
- Other players only see hidden card backs.
- The host starts hands and resolves showdown.
- Each player acts only from their own device on their own turn.

## Files

- `index.html`: multiplayer UI
- `styles.css`: table styling
- `firebase-config.js`: Firebase setup
- `firestore.js`: game state, table actions, and showdown logic
- `app.js`: auth flow and UI bindings

## Firebase Collections

- `pokerUsers`
- `pokerGames`
- `pokerGames/{gameId}/hands/{userId}`

## Important Security Note

To keep hole cards truly private, Firestore rules must only allow:

- each signed-in user to read their own hand doc
- the host to read all hand docs for showdown resolution
- public table readers to read the main game document only

Without those rules, hidden cards are only hidden by the UI, not by the database.
